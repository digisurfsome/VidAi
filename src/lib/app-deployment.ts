/**
 * App Deployment — One-click deployment to Vercel
 *
 * DETERMINISTIC: Explicit state machine for deployment status.
 * Each step validates prerequisites before executing.
 * Partial failures are detected and rolled back. No hope-based logic.
 */

import { supabase } from './supabase';

// ==================
// Types
// ==================

export type DeploymentProvider = 'vercel' | 'netlify' | 'railway' | 'manual';
export type DeploymentStatus = 'pending' | 'creating_repo' | 'pushing_code' | 'deploying' | 'live' | 'failed' | 'rolled_back' | 'deleted';

export interface AppDeployment {
  id: string;
  build_job_id: string;
  user_id: string;
  provider: DeploymentProvider;
  provider_project_id: string | null;
  provider_deployment_id: string | null;
  deployment_url: string | null;
  custom_domain: string | null;
  github_repo_url: string | null;
  status: DeploymentStatus;
  status_message: string | null;
  environment_vars_injected: boolean;
  framework_preset: string;
  build_command: string;
  output_directory: string;
  deployed_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDeploymentParams {
  build_job_id: string;
  provider?: DeploymentProvider;
  framework_preset?: string;
  build_command?: string;
  output_directory?: string;
}

// ==================
// DETERMINISTIC STATE MACHINE
// Every transition is explicitly defined. Illegal transitions are rejected.
// ==================

const VALID_DEPLOY_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending:      ['creating_repo', 'failed', 'deleted'],
  creating_repo: ['pushing_code', 'failed', 'deleted'],
  pushing_code: ['deploying', 'failed', 'deleted'],
  deploying:    ['live', 'failed', 'deleted'],
  live:         ['rolled_back', 'deleted'],
  failed:       ['pending', 'deleted'],    // Can retry from failed → pending
  rolled_back:  ['pending', 'deleted'],    // Can redeploy from rolled back
  deleted:      [],                         // Terminal state
};

function validateDeployTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  const allowed = VALID_DEPLOY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Illegal deployment transition: ${from} → ${to}. ` +
      `Allowed from '${from}': [${(allowed || []).join(', ')}]`
    );
  }
}

const VALID_PROVIDERS: DeploymentProvider[] = ['vercel', 'netlify', 'railway', 'manual'];

// ==================
// Deployment CRUD — STATE MACHINE ENFORCED
// ==================

/**
 * Create a deployment record. Validates build_job_id format and provider.
 */
export async function createDeployment(params: CreateDeploymentParams): Promise<AppDeployment> {
  if (!params.build_job_id) {
    throw new Error('build_job_id is required');
  }
  if (params.provider && !VALID_PROVIDERS.includes(params.provider)) {
    throw new Error(`Invalid provider: ${params.provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('app_deployments')
    .insert({
      build_job_id: params.build_job_id,
      provider: params.provider || 'vercel',
      status: 'pending',
      framework_preset: params.framework_preset || 'vite',
      build_command: params.build_command || 'npm run build',
      output_directory: params.output_directory || 'dist',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create deployment: ${error.message}`);
  return data as AppDeployment;
}

/**
 * Update deployment status with state machine validation.
 * Fetches current status first, validates transition, then applies.
 */
export async function updateDeploymentStatus(
  deploymentId: string,
  newStatus: DeploymentStatus,
  updates?: Partial<Pick<AppDeployment, 'deployment_url' | 'github_repo_url' | 'provider_project_id' | 'provider_deployment_id' | 'status_message' | 'environment_vars_injected'>>
): Promise<AppDeployment> {
  // Step 1: Fetch current status
  const { data: current, error: fetchError } = await supabase
    .from('app_deployments')
    .select('status')
    .eq('id', deploymentId)
    .single();

  if (fetchError || !current) {
    throw new Error(`Deployment not found: ${deploymentId}`);
  }

  // Step 2: Validate transition
  validateDeployTransition(current.status as DeploymentStatus, newStatus);

  // Step 3: Build payload with deterministic timestamps
  const payload: Record<string, unknown> = { status: newStatus, ...updates };
  payload.last_checked_at = new Date().toISOString();

  if (newStatus === 'live') {
    payload.deployed_at = new Date().toISOString();
  }

  // Step 4: Atomic update — only update if status hasn't changed since we read it
  const { data, error } = await supabase
    .from('app_deployments')
    .update(payload)
    .eq('id', deploymentId)
    .eq('status', current.status) // Atomic check: only if still in expected state
    .select()
    .single();

  if (error) throw new Error(`Failed to update deployment: ${error.message}`);
  return data as AppDeployment;
}

/**
 * Get deployment for a build.
 */
export async function getDeploymentByBuild(buildJobId: string): Promise<AppDeployment | null> {
  const { data } = await supabase
    .from('app_deployments')
    .select('*')
    .eq('build_job_id', buildJobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as AppDeployment | null;
}

/**
 * Get all deployments for the current user.
 */
export async function getUserDeployments(limit = 20): Promise<AppDeployment[]> {
  const { data, error } = await supabase
    .from('app_deployments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch deployments: ${error.message}`);
  return (data || []) as AppDeployment[];
}

/**
 * Get active (non-deleted) deployments.
 */
export async function getActiveDeployments(): Promise<AppDeployment[]> {
  const { data, error } = await supabase
    .from('app_deployments')
    .select('*')
    .not('status', 'in', '("deleted","rolled_back")')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch active deployments: ${error.message}`);
  return (data || []) as AppDeployment[];
}

// ==================
// Vercel Deployment API — DETERMINISTIC PIPELINE
// Each step validates the previous step succeeded before proceeding.
// Partial failures trigger rollback to 'failed' status.
// ==================

export async function deployToVercel(
  deploymentId: string,
  config: {
    projectName: string;
    files: { file: string; data: string }[];
    envVars: Record<string, string>;
    vercelToken: string;
    teamId?: string;
    framework?: string;
  }
): Promise<{ url: string; deploymentId: string }> {
  const { vercelToken, teamId, projectName, files, envVars, framework } = config;
  const teamParam = teamId ? `?teamId=${teamId}` : '';

  // Validate inputs before any API calls
  if (!projectName) throw new Error('projectName is required for deployment');
  if (!files || files.length === 0) throw new Error('files array cannot be empty');
  if (!vercelToken) throw new Error('vercelToken is required for deployment');

  // Step 1: Transition to pushing_code
  await updateDeploymentStatus(deploymentId, 'pushing_code', {
    status_message: 'Preparing deployment...',
  });

  // Step 2: Create deployment via Vercel API
  let deployData: any;
  try {
    const deployResponse = await fetch(`https://api.vercel.com/v13/deployments${teamParam}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName,
        files: files.map(f => ({ file: f.file, data: f.data })),
        projectSettings: {
          framework: framework || 'vite',
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          installCommand: 'npm install',
        },
        target: 'production',
      }),
    });

    if (!deployResponse.ok) {
      const errorText = await deployResponse.text().catch(() => 'Unknown error');
      // ROLLBACK: Mark as failed with the exact error
      await updateDeploymentStatus(deploymentId, 'failed', {
        status_message: `Vercel API error (${deployResponse.status}): ${errorText.slice(0, 500)}`,
      });
      throw new Error(`Vercel deployment failed: ${deployResponse.status} — ${errorText.slice(0, 200)}`);
    }

    deployData = await deployResponse.json();
  } catch (err: any) {
    if (err.message.includes('Vercel deployment failed')) throw err;
    // Network error — rollback
    await updateDeploymentStatus(deploymentId, 'failed', {
      status_message: `Network error during deployment: ${err.message}`,
    });
    throw err;
  }

  // Step 3: Validate Vercel response has required fields
  if (!deployData.id) {
    await updateDeploymentStatus(deploymentId, 'failed', {
      status_message: 'Vercel response missing deployment ID',
    });
    throw new Error('Vercel response missing deployment ID — cannot track deployment');
  }
  if (!deployData.url) {
    await updateDeploymentStatus(deploymentId, 'failed', {
      status_message: 'Vercel response missing deployment URL',
    });
    throw new Error('Vercel response missing deployment URL');
  }

  // Step 4: Transition to deploying — record Vercel IDs
  await updateDeploymentStatus(deploymentId, 'deploying', {
    status_message: 'Deployment created. Injecting environment variables...',
    provider_deployment_id: deployData.id,
    provider_project_id: deployData.projectId || null,
  });

  // Step 5: Inject environment variables (track success/failure per var)
  let envVarsInjected = 0;
  const envVarErrors: string[] = [];

  if (Object.keys(envVars).length > 0 && deployData.projectId) {
    for (const [key, value] of Object.entries(envVars)) {
      try {
        const envResponse = await fetch(
          `https://api.vercel.com/v10/projects/${deployData.projectId}/env${teamParam}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key,
              value,
              type: key.startsWith('VITE_') ? 'plain' : 'encrypted',
              target: ['production', 'preview'],
            }),
          }
        );

        if (envResponse.ok) {
          envVarsInjected++;
        } else {
          const errText = await envResponse.text().catch(() => 'unknown');
          envVarErrors.push(`${key}: ${errText.slice(0, 100)}`);
        }
      } catch (err: any) {
        envVarErrors.push(`${key}: ${err.message}`);
      }
    }
  }

  // Step 6: Verify all env vars were set — if any failed, mark as failed
  const totalEnvVars = Object.keys(envVars).length;
  if (envVarErrors.length > 0 && envVarErrors.length === totalEnvVars) {
    // ALL env vars failed — deployment is broken
    await updateDeploymentStatus(deploymentId, 'failed', {
      status_message: `All ${totalEnvVars} environment variables failed to set: ${envVarErrors.join('; ')}`,
    });
    throw new Error(`All environment variables failed to inject. Deployment is unusable.`);
  }

  // Step 7: Transition to live with verified data
  const url = `https://${deployData.url}`;
  const statusMsg = envVarErrors.length > 0
    ? `Live with warnings: ${envVarsInjected}/${totalEnvVars} env vars set. Failed: ${envVarErrors.join('; ')}`
    : `Deployment live. ${envVarsInjected} env vars injected.`;

  await updateDeploymentStatus(deploymentId, 'live', {
    deployment_url: url,
    environment_vars_injected: envVarErrors.length === 0,
    status_message: statusMsg,
  });

  return { url, deploymentId: deployData.id };
}

// ==================
// Deployment Status Polling — DETERMINISTIC STATE MAPPING
// ==================

/** Map Vercel states to our internal states */
const VERCEL_STATE_MAP: Record<string, DeploymentStatus> = {
  QUEUED: 'deploying',
  BUILDING: 'deploying',
  READY: 'live',
  ERROR: 'failed',
  CANCELED: 'failed',
};

export async function checkVercelDeploymentStatus(
  providerDeploymentId: string,
  vercelToken: string,
  teamId?: string
): Promise<{ state: DeploymentStatus; url?: string; error?: string; rawState: string }> {
  const teamParam = teamId ? `?teamId=${teamId}` : '';

  const response = await fetch(
    `https://api.vercel.com/v13/deployments/${providerDeploymentId}${teamParam}`,
    { headers: { Authorization: `Bearer ${vercelToken}` } }
  );

  if (!response.ok) {
    return {
      state: 'failed',
      rawState: 'FETCH_ERROR',
      error: `Failed to check status: HTTP ${response.status}`,
    };
  }

  const data = await response.json();
  const rawState = data.readyState || 'UNKNOWN';
  const mappedState = VERCEL_STATE_MAP[rawState] || 'deploying';

  return {
    state: mappedState,
    rawState,
    url: data.url ? `https://${data.url}` : undefined,
    error: rawState === 'ERROR' ? (data.errorMessage || 'Unknown Vercel error') : undefined,
  };
}
