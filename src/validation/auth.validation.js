const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email('Please provide a valid email address').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  role: z.enum(['candidate', 'company'], {
    errorMap: () => ({ message: 'Role must be candidate or company. Admin accounts cannot be self-selected.' }),
  }),
  // If candidate
  name: z.string().min(2, 'Name must be at least 2 characters').trim().optional(),
  // If company
  companyName: z.string().min(2, 'Company name is required').trim().optional(),
  domain: z.string().min(3, 'Valid company domain is required').trim().optional(),
  website: z.string().url('Valid website URL is required').optional(),
});

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

module.exports = {
  registerSchema,
  loginSchema,
};

