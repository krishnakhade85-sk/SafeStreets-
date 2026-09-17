/**
 * SafeStreets Mumbai - Vercel Serverless Function (Wildcard Subroutes /api/*)
 * Handles /api/routes/compare, /api/stats, /api/locations, /api/reviews, etc.
 */

const { handleRequest } = require('../server/server.js');

module.exports = async (req, res) => {
  return handleRequest(req, res);
};
