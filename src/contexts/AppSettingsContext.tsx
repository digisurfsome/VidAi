import React, { createContext, useContext, useEffect, useState } from 'react'
import { getPublicAppSettings, DEFAULT_APP_SETTINGS } from '@/lib/app-settings'

interface AppSettings {
  app_name: string
  app_logo_url: string
  app_favicon_url: string
  app_description: string
}

interface AppSettingsContextType {
  settings: AppSettings
  loading: boolean
  refreshSettings: () => Promise<void>
}

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined)

export const AppSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)

  const refreshSettings = async () => {
    try {
      console.log('Loading app settings...')
      setLoading(true)
      const appSettings = await getPublicAppSettings()
      console.log('App settings loaded:', appSettings)
      setSettings(appSettings)
    } catch (error) {
      console.error('Failed to load app settings:', error)
      // Fallback to default settings
      setSettings(DEFAULT_APP_SETTINGS)
    } finally {
      console.log('Setting loading to false')
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshSettings()
  }, [])

  return (
    <AppSettingsContext.Provider value={{ settings, loading, refreshSettings }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export const useAppSettings = () => {
  const context = useContext(AppSettingsContext)
  if (context === undefined) {
    throw new Error('useAppSettings must be used within an AppSettingsProvider')
  }
  return context
}