/**
 * Build Delivery — Receipt generation and delivery management
 *
 * DETERMINISTIC: Manifest hash is mandatory — no receipt without proof.
 * Test counts are validated (passed <= total). Routes structure is
 * verified. Receipt format is consistent and reproducible.
 */

import { supabase } from './supabase';
import type { BuildJob } from './build-jobs';

// ==================
// Types
// ==================

export interface BuildDelivery {
  id: string;
  build_job_id: string;
  user_id: string;
  app_name: string;
  tech_stack: string[];
  routes: RouteMap | null;
  files_delivered: number;
  features_included: string[] | null;
  tests_passed: number;
  tests_total: number;
  visual_qa_score: number | null;
  phase_results: Record<string, unknown> | null;
  manifest_hash: string | null;
  manifest_data: ManifestData | null;
  receipt_pdf_url: string | null;
  screenshots: string[] | null;
  test_report_url: string | null;
  session_video_url: string | null;
  delivered_at: string;
  download_url: string | null;
  download_expires_at: string | null;
  created_at: string;
}

export interface RouteMap {
  public: string[];
  authenticated: string[];
  admin: string[];
}

export interface ManifestData {
  app_id: string;
  generated_at: string;
  total_files: number;
  integrity_hash: string;
  files: FileHash[];
}

export interface FileHash {
  path: string;
  hash: string;
  size: number;
}

export interface CreateDeliveryParams {
  build_job_id: string;
  app_name: string;
  tech_stack: string[];
  routes?: RouteMap;
  files_delivered: number;
  features_included?: string[];
  tests_passed: number;
  tests_total: number;
  visual_qa_score?: number;
  phase_results?: Record<string, unknown>;
  manifest_hash?: string;
  manifest_data?: ManifestData;
  screenshots?: string[];
  test_report_url?: string;
  session_video_url?: string;
  download_url?: string;
}

// ==================
// Receipt Generation
// ==================

/**
 * Validate delivery receipt params.
 * DETERMINISTIC: Rejects invalid data rather than silently accepting it.
 */
function validateDeliveryParams(params: CreateDeliveryParams): void {
  if (!params.build_job_id) throw new Error('build_job_id is required');
  if (!params.app_name || typeof params.app_name !== 'string') {
    throw new Error('app_name is required and must be a non-empty string');
  }
  if (!Array.isArray(params.tech_stack) || params.tech_stack.length === 0) {
    throw new Error('tech_stack is required and must be a non-empty array');
  }
  if (typeof params.files_delivered !== 'number' || params.files_delivered < 0) {
    throw new Error('files_delivered must be a non-negative number');
  }

  // Test count validation — passed can never exceed total
  if (typeof params.tests_passed !== 'number' || params.tests_passed < 0) {
    throw new Error('tests_passed must be a non-negative number');
  }
  if (typeof params.tests_total !== 'number' || params.tests_total < 0) {
    throw new Error('tests_total must be a non-negative number');
  }
  if (params.tests_passed > params.tests_total) {
    throw new Error(
      `Test count invalid: tests_passed (${params.tests_passed}) cannot exceed ` +
      `tests_total (${params.tests_total})`
    );
  }

  // Visual QA score must be 0-100
  if (params.visual_qa_score !== undefined) {
    if (typeof params.visual_qa_score !== 'number' || params.visual_qa_score < 0 || params.visual_qa_score > 100) {
      throw new Error('visual_qa_score must be between 0 and 100');
    }
  }

  // Manifest hash is mandatory — no receipt without proof
  if (!params.manifest_hash || typeof params.manifest_hash !== 'string') {
    throw new Error(
      'manifest_hash is required for delivery receipts. ' +
      'Every delivery must have a cryptographic manifest for the Build Guarantee.'
    );
  }

  // Routes structure validation
  if (params.routes) {
    if (typeof params.routes !== 'object') {
      throw new Error('routes must be an object with public, authenticated, and admin arrays');
    }
    for (const key of ['public', 'authenticated', 'admin'] as const) {
      if (params.routes[key] !== undefined && !Array.isArray(params.routes[key])) {
        throw new Error(`routes.${key} must be an array of route strings`);
      }
    }
  }
}

/**
 * Create a delivery receipt for a completed build.
 * DETERMINISTIC: All inputs validated. Manifest hash mandatory.
 * Test counts verified. Routes structure checked.
 */
export async function createDeliveryReceipt(params: CreateDeliveryParams): Promise<BuildDelivery> {
  validateDeliveryParams(params);

  const { data, error } = await supabase
    .from('build_deliveries')
    .insert({
      build_job_id: params.build_job_id,
      app_name: params.app_name,
      tech_stack: params.tech_stack,
      routes: params.routes || null,
      files_delivered: params.files_delivered,
      features_included: params.features_included || null,
      tests_passed: params.tests_passed,
      tests_total: params.tests_total,
      visual_qa_score: params.visual_qa_score ?? null,
      phase_results: params.phase_results || null,
      manifest_hash: params.manifest_hash,
      manifest_data: params.manifest_data || null,
      screenshots: params.screenshots || null,
      test_report_url: params.test_report_url || null,
      session_video_url: params.session_video_url || null,
      download_url: params.download_url || null,
      download_expires_at: params.download_url
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
        : null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create delivery receipt: ${error.message}`);
  return data as BuildDelivery;
}

/**
 * Get a delivery receipt by build job ID.
 */
export async function getDeliveryByBuild(buildJobId: string): Promise<BuildDelivery | null> {
  const { data } = await supabase
    .from('build_deliveries')
    .select('*')
    .eq('build_job_id', buildJobId)
    .maybeSingle();

  return data as BuildDelivery | null;
}

/**
 * Get all deliveries for a user.
 */
export async function getUserDeliveries(limit = 20): Promise<BuildDelivery[]> {
  const { data, error } = await supabase
    .from('build_deliveries')
    .select('*')
    .order('delivered_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch deliveries: ${error.message}`);
  return (data || []) as BuildDelivery[];
}

// ==================
// Receipt Formatting
// ==================

/**
 * Generate a plaintext receipt for display or email.
 */
export function formatReceipt(delivery: BuildDelivery, build?: BuildJob): string {
  const divider = '─'.repeat(50);

  const lines = [
    '',
    'BUILD DELIVERY RECEIPT',
    divider,
    `App:            ${delivery.app_name}`,
    `Built:          ${new Date(delivery.delivered_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Build ID:       ${delivery.build_job_id}`,
    '',
    `Tech Stack:     ${delivery.tech_stack.join(' + ')}`,
    `Files Delivered: ${delivery.files_delivered}`,
    `Tests Passed:   ${delivery.tests_passed}/${delivery.tests_total}`,
  ];

  if (delivery.visual_qa_score !== null) {
    lines.push(`Visual QA:      ${delivery.visual_qa_score}/100`);
  }

  if (build) {
    lines.push(`Build Time:     ${build.completed_at && build.started_at
      ? `${Math.round((new Date(build.completed_at).getTime() - new Date(build.started_at).getTime()) / 1000)}s`
      : 'N/A'}`);
    if (build.retry_count > 0) {
      lines.push(`Attempts:       ${build.retry_count + 1}`);
    }
  }

  if (delivery.routes) {
    lines.push('');
    lines.push('Routes:');
    if (delivery.routes.public?.length) {
      lines.push(`  Public:         ${delivery.routes.public.length} routes`);
    }
    if (delivery.routes.authenticated?.length) {
      lines.push(`  Authenticated:  ${delivery.routes.authenticated.length} routes`);
    }
    if (delivery.routes.admin?.length) {
      lines.push(`  Admin:          ${delivery.routes.admin.length} routes`);
    }
  }

  if (delivery.features_included?.length) {
    lines.push('');
    lines.push('Features Included:');
    for (const feature of delivery.features_included) {
      lines.push(`  ✓ ${feature}`);
    }
  }

  if (delivery.manifest_hash) {
    lines.push('');
    lines.push(`Manifest ID:    ${delivery.manifest_hash.slice(0, 16)}...`);
    lines.push('(Full manifest available in Build Integrity dashboard)');
  }

  lines.push('');
  lines.push(divider);

  return lines.join('\n');
}

/**
 * Generate HTML receipt for email delivery.
 */
export function formatReceiptHTML(delivery: BuildDelivery, brandName = 'VidAi'): string {
  const testsPassed = delivery.tests_total > 0
    ? Math.round((delivery.tests_passed / delivery.tests_total) * 100)
    : 0;

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { font-size: 24px; margin: 0; }
    .header p { color: #666; margin-top: 8px; }
    .card { background: #f8f9fa; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .card h2 { font-size: 16px; margin: 0 0 16px 0; color: #333; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: 600; }
    .feature { padding: 4px 0; }
    .feature::before { content: '✓ '; color: #22c55e; font-weight: bold; }
    .score { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: 600; font-size: 14px; }
    .score-high { background: #dcfce7; color: #166534; }
    .score-mid { background: #fef9c3; color: #854d0e; }
    .score-low { background: #fee2e2; color: #991b1b; }
    .manifest { font-family: monospace; font-size: 12px; color: #666; background: #f1f5f9; padding: 12px; border-radius: 8px; margin-top: 16px; word-break: break-all; }
    .footer { text-align: center; margin-top: 32px; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Build Delivery Receipt</h1>
    <p>${brandName}</p>
  </div>

  <div class="card">
    <h2>Build Summary</h2>
    <div class="row">
      <span class="label">App Name</span>
      <span class="value">${delivery.app_name}</span>
    </div>
    <div class="row">
      <span class="label">Delivered</span>
      <span class="value">${new Date(delivery.delivered_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
    </div>
    <div class="row">
      <span class="label">Tech Stack</span>
      <span class="value">${delivery.tech_stack.join(' + ')}</span>
    </div>
    <div class="row">
      <span class="label">Files</span>
      <span class="value">${delivery.files_delivered}</span>
    </div>
  </div>

  <div class="card">
    <h2>Quality Metrics</h2>
    <div class="row">
      <span class="label">Tests Passed</span>
      <span class="value">${delivery.tests_passed}/${delivery.tests_total} <span class="score ${testsPassed >= 90 ? 'score-high' : testsPassed >= 70 ? 'score-mid' : 'score-low'}">${testsPassed}%</span></span>
    </div>
    ${delivery.visual_qa_score !== null ? `
    <div class="row">
      <span class="label">Visual QA Score</span>
      <span class="value"><span class="score ${delivery.visual_qa_score >= 85 ? 'score-high' : delivery.visual_qa_score >= 70 ? 'score-mid' : 'score-low'}">${delivery.visual_qa_score}/100</span></span>
    </div>` : ''}
  </div>

  ${delivery.features_included?.length ? `
  <div class="card">
    <h2>Features Included</h2>
    ${delivery.features_included.map(f => `<div class="feature">${f}</div>`).join('')}
  </div>` : ''}

  ${delivery.manifest_hash ? `
  <div class="manifest">
    Manifest ID: ${delivery.manifest_hash}<br>
    This receipt is your proof of delivery for the Build Guarantee.
  </div>` : ''}

  <div class="footer">
    <p>This receipt was automatically generated by ${brandName}'s Build Integrity System.</p>
    <p>Questions? Contact us — your build is covered by our guarantee.</p>
  </div>
</body>
</html>`;
}
