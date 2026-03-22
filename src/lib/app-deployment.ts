/**
 * App Deployment — One-click deployment to Vercel
 *
 * Handles the full deployment pipeline:
 * 1. Create GitHub repo for the built app
 * 2. Push code to the repo
 * 3. Create Vercel project linked to the repo
 * 4. Inject environment variables from the secret vault
 * 5. Deploy and return the live URL
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

export interface DeploymentConfig {
  vercel_token?: string;
  github_token?: string;
  team_id?: string;
}

// ==================
// Deployment CRUD
// ==================

/**
 * Create a deployment record. Called when the user initiates deployment.
 */
export async function createDeployment(params: CreateDeploymentParams): Promise<AppDeployment> {
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
 * Update deployment status and related fields.
 */
export async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
  updates?: Partial<Pick<AppDeployment, 'deployment_url' | 'github_repo_url' | 'provider_project_id' | 'provider_deployment_id' | 'status_message' | 'environment_vars_injected'>>
): Promise<AppDeployment> {
  const payload: Record<string, unknown> = { status, ...updates };

  if (status === 'live') {
    payload.deployed_at = new Date().toISOString();
  }
  payload.last_checked_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('app_deployments')
    .update(payload)
    .eq('id', deploymentId)
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
// Vercel Deployment API
// ==================

/**
 * Deploy to Vercel via their API.
 * Called server-side from the deployment API endpoint.
 *
 * This is the core deployment pipeline:
 * 1. Create Vercel project (or link to existing)
 * 2. Set environment variables
 * 3. Deploy
 */
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

  // Step 1: Update status to creating
  await updateDeploymentStatus(deploymentId, 'pushing_code', {
    status_message: 'Preparing deployment...',
  });

  // Step 2: Create deployment via Vercel API
  const deployResponse = await fetch(`https://api.vercel.com/v13/deployments${teamParam}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      files: files.map(f => ({
        file: f.file,
        data: f.data,
      })),
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
    const errorData = await deployResponse.json().catch(() => ({}));
    throw new Error(`Vercel deployment failed: ${JSON.stringify(errorData)}`);
  }

  const deployData = await deployResponse.json();

  // Step 3: Set environment variables
  if (Object.keys(envVars).length > 0 && deployData.projectId) {
    await updateDeploymentStatus(deploymentId, 'deploying', {
      status_message: 'Setting environment variables...',
      provider_project_id: deployData.projectId,
    });

    for (const [key, value] of Object.entries(envVars)) {
      await fetch(`https://api.vercel.com/v10/projects/${deployData.projectId}/env${teamParam}`, {
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
      });
    }
  }

  // Step 4: Update deployment record with live URL
  const url = `https://${deployData.url}`;
  await updateDeploymentStatus(deploymentId, 'live', {
    deployment_url: url,
    provider_deployment_id: deployData.id,
    provider_project_id: deployData.projectId,
    environment_vars_injected: Object.keys(envVars).length > 0,
    status_message: 'Deployment live',
  });

  return { url, deploymentId: deployData.id };
}

// ==================
// Deployment Status Polling
// ==================

/**
 * Check Vercel deployment status.
 * Used to poll for deployment completion if the initial response is still building.
 */
export async function checkVercelDeploymentStatus(
  providerDeploymentId: string,
  vercelToken: string,
  teamId?: string
): Promise<{ state: string; url?: string; error?: string }> {
  const teamParam = teamId ? `?teamId=${teamId}` : '';

  const response = await fetch(
    `https://api.vercel.com/v13/deployments/${providerDeploymentId}${teamParam}`,
    {
      headers: { Authorization: `Bearer ${vercelToken}` },
    }
  );

  if (!response.ok) {
    return { state: 'error', error: `Failed to check status: ${response.status}` };
  }

  const data = await response.json();
  return {
    state: data.readyState, // QUEUED, BUILDING, READY, ERROR, CANCELED
    url: data.url ? `https://${data.url}` : undefined,
    error: data.readyState === 'ERROR' ? (data.errorMessage || 'Unknown error') : undefined,
  };
}
