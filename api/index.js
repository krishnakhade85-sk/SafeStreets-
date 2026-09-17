/**
 * SafeStreets Mumbai - Vercel Serverless Function (Root /api Entry)
 * Bridges Vercel serverless requests to the native Node server request handler.
 */

const { handleRequest } = require('../server/server.js');

module.exports = async (req, res) => {
  return handleRequest(req, res);
};
