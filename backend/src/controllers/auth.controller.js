// src/controllers/auth.controller.js
//
// HTTP layer for /auth/*. Parses the request, calls the service, shapes
// the response.

const authService = require('../services/auth.service');

async function register(req, res, next) {
  try {
    const user = await authService.register(req.body);
    res.status(201).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { token, user } = await authService.login(req.body);
    res.status(200).json({ success: true, data: { token, user } });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login };
