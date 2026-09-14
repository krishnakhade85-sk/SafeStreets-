package com.example.safestreets

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {

    private var webViewInstance: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Activity Result Launcher for file/photo uploads in WebView
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    // Activity Result Launcher for Geolocation Runtime Permission
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var pendingGeoOrigin: String? = null

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                      permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        pendingGeoCallback?.invoke(pendingGeoOrigin, granted, false)
        pendingGeoCallback = null
        pendingGeoOrigin = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Handle Android system back gesture to navigate within WebView history
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webViewInstance?.canGoBack() == true) {
                    webViewInstance?.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Persistent custom cloud URL or default
        val prefs = getSharedPreferences("safestreets_prefs", Context.MODE_PRIVATE)
        val savedCloudUrl = prefs.getString("cloud_url", "https://safestreets-mumbai.onrender.com") 
            ?: "https://safestreets-mumbai.onrender.com"

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding(),
                    color = Color(0xFF0B0414) // Rich Deep Purple Canvas
                ) {
                    SafeStreetsAppView(
                        initialCloudUrl = savedCloudUrl,
                        onSaveCloudUrl = { newUrl ->
                            prefs.edit().putString("cloud_url", newUrl).apply()
                        },
                        onDial = { phoneUrl ->
                            val intent = Intent(Intent.ACTION_DIAL, Uri.parse(phoneUrl))
                            startActivity(intent)
                        },
                        onChooseFile = { callback, intent ->
                            filePathCallback = callback
                            fileChooserLauncher.launch(intent)
                        },
                        onRequestLocation = { origin, callback ->
                            val fineGranted = ContextCompat.checkSelfPermission(
                                this, Manifest.permission.ACCESS_FINE_LOCATION
                            ) == PackageManager.PERMISSION_GRANTED

                            if (fineGranted) {
                                callback.invoke(origin, true, false)
                            } else {
                                pendingGeoOrigin = origin
                                pendingGeoCallback = callback
                                locationPermissionLauncher.launch(
                                    arrayOf(
                                        Manifest.permission.ACCESS_FINE_LOCATION,
                                        Manifest.permission.ACCESS_COARSE_LOCATION
                                    )
                                )
                            }
                        },
                        onWebViewReady = { wv -> webViewInstance = wv }
                    )
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SafeStreetsAppView(
    initialCloudUrl: String,
    onSaveCloudUrl: (String) -> Unit,
    onDial: (String) -> Unit,
    onChooseFile: (ValueCallback<Array<Uri>>, Intent) -> Unit,
    onRequestLocation: (String, GeolocationPermissions.Callback) -> Unit,
    onWebViewReady: (WebView) -> Unit
) {
    var hasError by remember { mutableStateOf(false) }
    var currentUrl by remember { mutableStateOf(initialCloudUrl) }
    var customUrlInput by remember { mutableStateOf(initialCloudUrl) }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )

                    setBackgroundColor(android.graphics.Color.parseColor("#0B0414"))

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true
                        cacheMode = WebSettings.LOAD_DEFAULT
                        useWideViewPort = true
                        loadWithOverviewMode = true
                        setSupportZoom(false)
                        setGeolocationEnabled(true)
                    }

                    // WebChromeClient for Geolocation and File Chooser
                    webChromeClient = object : WebChromeClient() {
                        override fun onGeolocationPermissionsShowPrompt(
                            origin: String?,
                            callback: GeolocationPermissions.Callback?
                        ) {
                            if (origin != null && callback != null) {
                                onRequestLocation(origin, callback)
                            } else {
                                super.onGeolocationPermissionsShowPrompt(origin, callback)
                            }
                        }

                        override fun onShowFileChooser(
                            webView: WebView?,
                            filePathCallback: ValueCallback<Array<Uri>>?,
                            fileChooserParams: FileChooserParams?
                        ): Boolean {
                            if (filePathCallback != null) {
                                val intent = fileChooserParams?.createIntent() 
                                    ?: Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }
                                onChooseFile(filePathCallback, intent)
                                return true
                            }
                            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams)
                        }
                    }

                    // WebViewClient for navigation and dialing
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): Boolean {
                            val url = request?.url?.toString() ?: return false
                            if (url.startsWith("tel:")) {
                                onDial(url)
                                return true
                            }
                            return false
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                            hasError = false
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: WebResourceError?
                        ) {
                            super.onReceivedError(view, request, error)
                            hasError = true
                        }
                    }

                    loadUrl(currentUrl)
                    onWebViewReady(this)
                }
            }
        )

        // Offline / Cloud Connection Screen with Rich Purple Styling
        if (hasError) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xFF0B0414))
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "SafeStreets Mumbai",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE9D5FF)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Cloud-Connected Community Safety Map",
                        fontSize = 13.sp,
                        color = Color(0xFFC084FC),
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Unable to reach the cloud server at:\n$currentUrl\n\nEnter your production cloud URL below or retry connection.",
                        fontSize = 13.sp,
                        color = Color(0xFFD1C4E9),
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(20.dp))

                    OutlinedTextField(
                        value = customUrlInput,
                        onValueChange = { customUrlInput = it },
                        label = { Text("Cloud Server URL", color = Color(0xFFC084FC)) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFA855F7),
                            unfocusedBorderColor = Color(0xFF6B21A8),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFE9D5FF)
                        ),
                        modifier = Modifier.fillMaxWidth(0.9f),
                        singleLine = true
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Button(
                        onClick = {
                            val target = if (customUrlInput.isNotBlank()) customUrlInput.trim() else currentUrl
                            currentUrl = target
                            onSaveCloudUrl(target)
                            hasError = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier.fillMaxWidth(0.9f)
                    ) {
                        Text("Connect to Cloud Server", color = Color.White, fontWeight = FontWeight.Bold)
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = { onDial("tel:103") },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE11D48)),
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier.fillMaxWidth(0.9f)
                    ) {
                        Text("Urgent: Call Mumbai Women Helpline 103", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
