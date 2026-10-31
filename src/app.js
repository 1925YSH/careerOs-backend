const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const env = require('./config/env');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter, billingLimiter, aiLimiter } = require('./middleware/rateLimiter');
const { sanitizeNoSql, sanitizeXss, hppGuard } = require('./middleware/sanitizer');
const { NotFoundError } = require('./utils/errors');

// Route imports
const authRoutes = require('./routes/auth.routes');
const jobRoutes = require('./routes/jobs.routes');
const applicationRoutes = require('./routes/applications.routes');
const companyRoutes = require('./routes/companies.routes');
const resumeRoutes = require('./routes/resumes.routes');
const candidateRoutes = require('./routes/candidate.routes');
const agentRoutes = require('./routes/agent.routes');
const adminRoutes = require('./routes/admin.routes');
const notificationRoutes = require('./routes/notifications.routes');
const billingRoutes = require('./routes/billing.routes');
const usersRoutes = require('./routes/users.routes');

const app = express();

// Trust proxy if in production (for accurate IP in rate limiting & logs)
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 1. Security Headers (OWASP recommendations)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    dnsPrefetchControl: { allow: false },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    crossOriginEmbedderPolicy: false,
  })
);

// 2. Strict CORS Configuration
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  })
);

// 3. Observability & Correlation
app.use(requestId);
if (env.NODE_ENV !== 'test') {
  app.use(
    morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms [req: :req[x-request-id]]')
  );
}

// 4. Request Parsers with Size Guards (OWASP DoS prevention)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(env.COOKIE_SECRET));

// 4.1 Input Sanitization & Anti-Pollution Suite (OWASP ASVS 5.0)
app.use(sanitizeNoSql);
app.use(sanitizeXss);
app.use(hppGuard);

// 5. Global Rate Limiter
app.use('/api', apiLimiter);

// 6. Health & Readiness Probe
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
  });
});

// 7. Domain API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/agent', aiLimiter, agentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/billing', billingLimiter, billingRoutes);
app.use('/api/users', usersRoutes);

// 8. 404 Route Catch-all
app.use('*', (req, res, next) => {
  next(new NotFoundError(`Route ${req.originalUrl} not found`));
});

// 9. Central Error Handling Middleware (Unified Error Envelope)
app.use(errorHandler);

module.exports = app;

