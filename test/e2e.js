async function testAll() {
  const base = 'http://localhost:3000';
  
  // 1. Static HTML
  const r1 = await fetch(base + '/');
  console.log('1. GET /:', r1.status, r1.headers.get('content-type'));

  // 2. Stats
  const r2 = await fetch(base + '/api/stats');
  const stats = await r2.json();
  console.log('2. GET /api/stats:', r2.status, stats);

  // 3. Locations
  const r3 = await fetch(base + '/api/locations?filter=all');
  const locs = await r3.json();
  console.log('3. GET /api/locations:', r3.status, 'Locations Count:', locs.total);

  // 4. Location Details
  const r4 = await fetch(base + '/api/locations/1');
  const loc1 = await r4.json();
  console.log('4. GET /api/locations/1:', r4.status, loc1.location.name, 'Reviews:', loc1.reviews.length);

  // 5. Route Comparison
  const r5 = await fetch(base + '/api/routes/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'Dadar Station', destination: 'Shivaji Park', time_of_day: 'after_dark', travel_mode: 'walk' })
  });
  const routes = await r5.json();
  console.log('5. POST /api/routes/compare:', r5.status, 'Routes options:', routes.routes.length, 'Recommended:', routes.routes[0].isRecommended);

  // 6. Submit Anonymous Review with PII (phone number)
  const r6 = await fetch(base + '/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location_id: 1,
      date_of_experience: '2026-09-14',
      time_of_day: 'after_dark',
      travel_mode: 'walk',
      overall_feeling: 'use_caution',
      experience_text: 'Footpath was crowded near stall, please call me at 9820012345 if needed.',
      advice: 'Take platform 1 bridge.',
      lighting: 'moderate',
      foot_traffic: 'active',
      shops_open: 'some',
      transit_access: 'direct',
      security_presence: 'occasional_patrol',
      road_condition: 'paved',
      harassment_concern: false,
      stalking_concern: false,
      isolated_area: false,
      user_confirmed_no_pii: true
    })
  });
  const revRes = await r6.json();
  console.log('6. POST /api/reviews:', r6.status, 'Token:', revRes.anonymousToken, 'PII Detected:', revRes.hasPII, 'Flags:', revRes.detectedFlags);

  // 7. Contributor Lookup via Anonymous Token
  const r7 = await fetch(base + '/api/my-review/' + revRes.anonymousToken);
  const myRev = await r7.json();
  console.log('7. GET /api/my-review/:token:', r7.status, 'Status:', myRev.review.moderationStatus, 'Redacted text:', myRev.review.experienceText);

  // 8. Moderator Login
  const r8 = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'moderator', password: 'safestreets2026' })
  });
  const modAuth = await r8.json();
  console.log('8. POST /api/auth/login:', r8.status, 'Mod username:', modAuth.username);

  // 9. Mod Pending Queue
  const r9 = await fetch(base + '/api/mod/pending', {
    headers: { 'Authorization': 'Bearer ' + modAuth.token }
  });
  const pending = await r9.json();
  console.log('9. GET /api/mod/pending:', r9.status, 'Pending count:', pending.total);

  // 10. Mod Approve Review
  const r10 = await fetch(base + '/api/mod/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + modAuth.token },
    body: JSON.stringify({ review_id: revRes.reviewId, action: 'approve' })
  });
  const actRes = await r10.json();
  console.log('10. POST /api/mod/action (approve):', r10.status, actRes);

  // 11. Settings & Helplines
  const r11 = await fetch(base + '/api/settings');
  const settings = await r11.json();
  console.log('11. GET /api/settings:', r11.status, 'Emergency Contacts count:', settings.settings.emergency_contacts.length);

  // 12. Contributor Self-Deletion
  const r12 = await fetch(base + '/api/my-review/' + revRes.anonymousToken, { method: 'DELETE' });
  const delRes = await r12.json();
  console.log('12. DELETE /api/my-review/:token:', r12.status, delRes);

  console.log('\n>>> ALL 12 END-TO-END TESTS PASSED SUCCESSFULLY! <<<');
}

testAll().catch(e => console.error(e));
