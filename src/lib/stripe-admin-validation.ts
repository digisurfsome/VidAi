// Validation schemas for Stripe Admin API
// Uses Zod for type-safe validation with detailed error messages

import { z } from 'zod';

// Base validation rules
const PRICE_MIN = 99; // $0.99 minimum
const PRICE_MAX = 99999; // $999.99 maximum
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;
const CREDITS_MIN = 0;
const CREDITS_MAX = 1000000; // 1M credits max
const BONUS_PERCENTAGE_MAX = 100;

// Custom error messages
const ErrorMessages = {
  REQUIRED: 'This field is required',
  NAME_TOO_LONG: `Name must be ${NAME_MAX_LENGTH} characters or less`,
  NAME_REQUIRED: 'Plan name is required',
  DESCRIPTION_TOO_LONG: `Description must be ${DESCRIPTION_MAX_LENGTH} characters or less`,
  PRICE_TOO_LOW: `Price must be at least $${(PRICE_MIN / 100).toFixed(2)}`,
  PRICE_TOO_HIGH: `Price must be no more than $${(PRICE_MAX / 100).toFixed(2)}`,
  PRICE_REQUIRED: 'Price is required',
  CREDITS_REQUIRED: 'Credits per period is required',
  CREDITS_NEGATIVE: 'Credits cannot be negative',
  CREDITS_TOO_HIGH: `Credits cannot exceed ${CREDITS_MAX.toLocaleString()}`,
  INVALID_INTERVAL: 'Billing interval must be either "month" or "year"',
  INVALID_CURRENCY: 'Currency must be a valid 3-letter code (e.g., USD, EUR)',
  INVALID_EMAIL: 'Please enter a valid email address',
  INVALID_UUID: 'Invalid ID format',
  BOOLEAN_REQUIRED: 'Must be true or false',
  ARRAY_REQUIRED: 'Must be an array',
  STRING_REQUIRED: 'Must be a text value',
  NUMBER_REQUIRED: 'Must be a number',
  CREDITS_MIN_REQUIRED: `Credits must be at least ${CREDITS_MIN}`,
  BONUS_TOO_HIGH: `Bonus percentage cannot exceed ${BONUS_PERCENTAGE_MAX}%`,
  BONUS_NEGATIVE: 'Bonus percentage cannot be negative',
};

// Subscription plan validation schemas
export const CreatePlanSchema = z.object({
  name: z
    .string({ required_error: ErrorMessages.NAME_REQUIRED })
    .min(1, ErrorMessages.NAME_REQUIRED)
    .max(NAME_MAX_LENGTH, ErrorMessages.NAME_TOO_LONG)
    .trim(),
    
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, ErrorMessages.DESCRIPTION_TOO_LONG)
    .trim()
    .optional(),
    
  price_cents: z
    .number({ required_error: ErrorMessages.PRICE_REQUIRED })
    .int('Price must be a whole number of cents')
    .min(PRICE_MIN, ErrorMessages.PRICE_TOO_LOW)
    .max(PRICE_MAX, ErrorMessages.PRICE_TOO_HIGH),
    
  currency: z
    .string()
    .length(3, ErrorMessages.INVALID_CURRENCY)
    .toUpperCase()
    .default('USD'),
    
  interval: z
    .enum(['month', 'year'], {
      errorMap: () => ({ message: ErrorMessages.INVALID_INTERVAL }),
    }),
    
  credits_per_period: z
    .number({ required_error: ErrorMessages.CREDITS_REQUIRED })
    .int('Credits must be a whole number')
    .min(CREDITS_MIN, ErrorMessages.CREDITS_MIN_REQUIRED)
    .max(CREDITS_MAX, ErrorMessages.CREDITS_TOO_HIGH),
    
  features: z
    .array(z.string().trim().min(1, 'Feature cannot be empty'))
    .default([])
    .transform(features => features.filter(f => f.length > 0)), // Remove empty strings
    
  is_active: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .default(true),
}).strict(); // Don't allow extra fields

export const UpdatePlanSchema = z.object({
  name: z
    .string()
    .min(1, ErrorMessages.NAME_REQUIRED)
    .max(NAME_MAX_LENGTH, ErrorMessages.NAME_TOO_LONG)
    .trim()
    .optional(),
    
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, ErrorMessages.DESCRIPTION_TOO_LONG)
    .trim()
    .optional(),
    
  price_cents: z
    .number()
    .int('Price must be a whole number of cents')
    .min(PRICE_MIN, ErrorMessages.PRICE_TOO_LOW)
    .max(PRICE_MAX, ErrorMessages.PRICE_TOO_HIGH)
    .optional(),
    
  features: z
    .array(z.string().trim().min(1, 'Feature cannot be empty'))
    .transform(features => features.filter(f => f.length > 0))
    .optional(),
    
  credits_per_period: z
    .number()
    .int('Credits must be a whole number')
    .min(CREDITS_MIN, ErrorMessages.CREDITS_MIN_REQUIRED)
    .max(CREDITS_MAX, ErrorMessages.CREDITS_TOO_HIGH)
    .optional(),
    
  is_active: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .optional(),
    
  archive: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .optional(),
}).strict()
.refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// Credit package validation schemas
export const CreatePackageSchema = z.object({
  name: z
    .string({ required_error: ErrorMessages.NAME_REQUIRED })
    .min(1, ErrorMessages.NAME_REQUIRED)
    .max(NAME_MAX_LENGTH, ErrorMessages.NAME_TOO_LONG)
    .trim(),
    
  credits: z
    .number({ required_error: ErrorMessages.CREDITS_REQUIRED })
    .int('Credits must be a whole number')
    .min(100, 'Credit packages must have at least 100 credits')
    .max(CREDITS_MAX, ErrorMessages.CREDITS_TOO_HIGH),
    
  price_cents: z
    .number({ required_error: ErrorMessages.PRICE_REQUIRED })
    .int('Price must be a whole number of cents')
    .min(PRICE_MIN, ErrorMessages.PRICE_TOO_LOW)
    .max(PRICE_MAX, ErrorMessages.PRICE_TOO_HIGH),
    
  bonus_percentage: z
    .number()
    .int('Bonus percentage must be a whole number')
    .min(0, ErrorMessages.BONUS_NEGATIVE)
    .max(BONUS_PERCENTAGE_MAX, ErrorMessages.BONUS_TOO_HIGH)
    .default(0),
    
  is_active: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .default(true),
    
  popular_badge: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .default(false),
}).strict()
.refine(data => {
  // Ensure reasonable cost per credit
  const totalCredits = data.credits * (1 + data.bonus_percentage / 100);
  const costPerCredit = data.price_cents / totalCredits;
  return costPerCredit >= 0.1; // At least 0.1 cents per credit
}, {
  message: 'Credit package pricing results in cost per credit that is too low',
  path: ['price_cents'],
});

export const UpdatePackageSchema = z.object({
  name: z
    .string()
    .min(1, ErrorMessages.NAME_REQUIRED)
    .max(NAME_MAX_LENGTH, ErrorMessages.NAME_TOO_LONG)
    .trim()
    .optional(),
    
  credits: z
    .number()
    .int('Credits must be a whole number')
    .min(100, 'Credit packages must have at least 100 credits')
    .max(CREDITS_MAX, ErrorMessages.CREDITS_TOO_HIGH)
    .optional(),
    
  price_cents: z
    .number()
    .int('Price must be a whole number of cents')
    .min(PRICE_MIN, ErrorMessages.PRICE_TOO_LOW)
    .max(PRICE_MAX, ErrorMessages.PRICE_TOO_HIGH)
    .optional(),
    
  bonus_percentage: z
    .number()
    .int('Bonus percentage must be a whole number')
    .min(0, ErrorMessages.BONUS_NEGATIVE)
    .max(BONUS_PERCENTAGE_MAX, ErrorMessages.BONUS_TOO_HIGH)
    .optional(),
    
  is_active: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .optional(),
    
  popular_badge: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .optional(),
    
  display_order: z
    .number()
    .int('Display order must be a whole number')
    .min(0, 'Display order cannot be negative')
    .optional(),
    
  archive: z
    .boolean({ errorMap: () => ({ message: ErrorMessages.BOOLEAN_REQUIRED }) })
    .optional(),
}).strict()
.refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// Query parameter validation
export const GetPlansQuerySchema = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .transform(val => val === 'true')
    .default('false'),
    
  sync_status: z
    .enum(['all', 'synced', 'pending', 'error'])
    .default('all'),
    
  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a number')
    .transform(val => Math.min(parseInt(val), 200))
    .default('50'),
    
  offset: z
    .string()
    .regex(/^\d+$/, 'Offset must be a number')
    .transform(val => parseInt(val))
    .default('0'),
});

export const SyncQuerySchema = z.object({
  direction: z
    .enum(['to_stripe', 'from_stripe', 'bidirectional'])
    .default('from_stripe'),
    
  force: z
    .enum(['true', 'false'])
    .transform(val => val === 'true')
    .default('false'),
});

// UUID validation for path parameters
export const UUIDSchema = z
  .string({ required_error: ErrorMessages.INVALID_UUID })
  .uuid(ErrorMessages.INVALID_UUID);

// Sync log query validation
export const SyncLogQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a number')
    .transform(val => Math.min(parseInt(val), 200))
    .default('50'),
    
  offset: z
    .string()
    .regex(/^\d+$/, 'Offset must be a number')
    .transform(val => parseInt(val))
    .default('0'),
    
  status: z
    .enum(['all', 'success', 'failure', 'partial'])
    .default('all'),
    
  entity_type: z
    .enum(['product', 'price', 'subscription', 'customer'])
    .optional(),
});

// Type exports for TypeScript
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;
export type CreatePackageInput = z.infer<typeof CreatePackageSchema>;
export type UpdatePackageInput = z.infer<typeof UpdatePackageSchema>;
export type GetPlansQuery = z.infer<typeof GetPlansQuerySchema>;
export type SyncQuery = z.infer<typeof SyncQuerySchema>;
export type SyncLogQuery = z.infer<typeof SyncLogQuerySchema>;

// Validation helper functions
export function validateCreatePlan(data: unknown): { success: true; data: CreatePlanInput } | { success: false; errors: string[] } {
  const result = CreatePlanSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`),
    };
  }
}

export function validateUpdatePlan(data: unknown): { success: true; data: UpdatePlanInput } | { success: false; errors: string[] } {
  const result = UpdatePlanSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`),
    };
  }
}

export function validateCreatePackage(data: unknown): { success: true; data: CreatePackageInput } | { success: false; errors: string[] } {
  const result = CreatePackageSchema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      errors: result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`),
    };
  }
}

// Price formatting utilities
export function formatPrice(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatCredits(credits: number): string {
  return new Intl.NumberFormat('en-US').format(credits);
}

// Calculate effective pricing
export function calculateEffectivePricing(credits: number, price_cents: number, bonus_percentage = 0) {
  const totalCredits = credits * (1 + bonus_percentage / 100);
  const costPerCredit = price_cents / totalCredits;
  const savings = bonus_percentage > 0 ? (bonus_percentage / 100) * credits : 0;
  
  return {
    totalCredits,
    costPerCredit: costPerCredit / 100, // Convert to dollars
    bonusCredits: Math.floor(savings),
    savings: formatPrice(Math.floor(savings * costPerCredit)),
  };
}

// Validation constants for use in components
export const ValidationConstants = {
  PRICE_MIN,
  PRICE_MAX,
  NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  CREDITS_MIN,
  CREDITS_MAX,
  BONUS_PERCENTAGE_MAX,
  
  // Formatted strings for UI
  PRICE_MIN_FORMATTED: formatPrice(PRICE_MIN),
  PRICE_MAX_FORMATTED: formatPrice(PRICE_MAX),
  CREDITS_MAX_FORMATTED: formatCredits(CREDITS_MAX),
} as const;