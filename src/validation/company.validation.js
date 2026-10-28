const { z } = require('zod');

const createOrUpdateProfileSchema = z.object({
  name: z.string().min(2, 'Company name must be at least 2 characters').max(100),
  domain: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a valid domain name (e.g. acme.com)'),
  careersUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  logoUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  description: z.string().max(3000).optional().or(z.literal('')),
  industry: z.string().max(100).optional().or(z.literal('')),
  location: z.string().max(100).optional().or(z.literal('')),
  size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
});

const baseJobSchema = z.object({
  title: z.string().min(3, 'Job title must be at least 3 characters').max(120),
  description: z.string().min(20, 'Job description must be at least 20 characters').max(20000),
  location: z.string().min(2, 'Location is required').max(120),
  workMode: z.enum(['remote', 'hybrid', 'on-site']).default('on-site'),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP']).default('FULL_TIME'),
  skills: z.array(z.string().min(1).max(50)).max(30).default([]),
  experienceMin: z.number().int().min(0).max(30).default(0),
  experienceMax: z.number().int().min(0).max(30).optional(),
  salary: z
    .object({
      min: z.number().min(0).optional(),
      max: z.number().min(0).optional(),
      currency: z.string().max(5).default('USD'),
      isDisclosed: z.boolean().default(false),
    })
    .optional(),
  applicationUrl: z.string().url('Must be a valid application URL').optional().or(z.literal('')),
  status: z.enum(['active', 'draft']).default('active'),
});

function applyJobRefinements(schema) {
  return schema
    .refine(
      (data) => {
        if (data.experienceMax !== undefined && data.experienceMin !== undefined && data.experienceMin > data.experienceMax) {
          return false;
        }
        return true;
      },
      {
        message: 'experienceMax must be greater than or equal to experienceMin',
        path: ['experienceMax'],
      }
    )
    .refine(
      (data) => {
        if (
          data.salary?.min !== undefined &&
          data.salary?.max !== undefined &&
          data.salary.min > data.salary.max
        ) {
          return false;
        }
        return true;
      },
      {
        message: 'Maximum salary must be greater than or equal to minimum salary',
        path: ['salary', 'max'],
      }
    );
}

const createJobSchema = applyJobRefinements(baseJobSchema);
const updateJobSchema = applyJobRefinements(baseJobSchema.partial());

const updateApplicantStatusSchema = z.object({
  status: z.enum(['saved', 'applied', 'reviewing', 'interview', 'offer', 'rejected', 'withdrawn']),
  note: z.string().max(500).optional(),
});

const submitSourceSchema = z.object({
  careersUrl: z.string().url('A valid careers URL is required (e.g. https://company.com/careers)'),
});

module.exports = {
  createOrUpdateProfileSchema,
  createJobSchema,
  updateJobSchema,
  updateApplicantStatusSchema,
  submitSourceSchema,
};
