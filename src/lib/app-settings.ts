// Client-side functions for managing app settings

interface AppSettings {
  app_name: string
  app_logo_url: string
  app_favicon_url: string
  app_description: string
}

interface AppSettingMeta {
  value: string
  type: string
  description: string
}

type AppSettingsWithMeta = Record<string, AppSettingMeta>

/**
 * Get public app settings (no authentication required)
 */
export const getPublicAppSettings = async (): Promise<AppSettings> => {
  try {
    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch('/api/app-settings', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result = await response.json()
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to get app settings')
    }

    return result.settings as AppSettings
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn('App settings request timed out, using defaults')
      return DEFAULT_APP_SETTINGS
    }
    console.error('Error getting public app settings:', error)
    // Return defaults instead of throwing
    return DEFAULT_APP_SETTINGS
  }
}

/**
 * Get all app settings (admin only)
 */
export const getAppSettings = async (adminUserId: string): Promise<AppSettingsWithMeta> => {
  try {
    const response = await fetch('/api/app-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId,
        action: 'get'
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result = await response.json()
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to get app settings')
    }

    return result.settings as AppSettingsWithMeta
  } catch (error) {
    console.error('Error getting app settings:', error)
    throw error
  }
}

/**
 * Update app settings (admin only)
 */
export const updateAppSettings = async (adminUserId: string, settings: Record<string, string>): Promise<void> => {
  try {
    const response = await fetch('/api/app-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminUserId,
        action: 'update',
        settings
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result = await response.json()
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update app settings')
    }
  } catch (error) {
    console.error('Error updating app settings:', error)
    throw error
  }
}

// Default values for app settings
export const DEFAULT_APP_SETTINGS: AppSettings = {
  app_name: 'AICoder 2025',
  app_logo_url: '',
  app_favicon_url: '',
  app_description: 'Modern AI-powered development codebase'
}