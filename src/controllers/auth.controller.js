const authService = require('../services/auth.service');
const env = require('../config/env');

// Helper to determine secure HttpOnly cookie options across environments
const getCookieOptions = () => {
  const isProduction = env.NODE_ENV === 'production';
  const isCrossDomain = env.CLIENT_URL && !env.CLIENT_URL.includes('localhost');
  return {
    httpOnly: true,
    secure: isProduction || isCrossDomain,
    sameSite: isCrossDomain ? 'none' : (isProduction ? 'strict' : 'lax'),
    path: '/',
  };
};

const setAuthCookie = (res, token) => {
  res.cookie('token', token, {
    ...getCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
    res.clearCookie('token', getCookieOptions());

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

