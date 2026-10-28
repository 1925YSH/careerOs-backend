const authService = require('../services/auth.service');
const env = require('../config/env');

// Helper to set secure HttpOnly cookie
const setAuthCookie = (res, token) => {
  const isProduction = env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
};

const register = async (req, res, next) => {
  try {
    const reqMeta = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
    const { user, token } = await authService.register(req.body, reqMeta);
    setAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const reqMeta = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
    const { email, password } = req.body;
    const { user, token } = await authService.login(email, password, reqMeta);
    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: 'Sign in successful',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
    });

    return res.status(200).json({
      success: true,
      message: 'Signed out successfully',
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const data = await authService.getMe(req.user._id, req.user.role);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  logout,
  getMe,
};

