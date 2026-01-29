import { useEffect } from 'react'
import { useAppSettings } from '@/contexts/AppSettingsContext'

export const useDocumentTitle = (suffix?: string) => {
  const { settings } = useAppSettings()

  useEffect(() => {
    const title = suffix ? `${suffix} - ${settings.app_name}` : settings.app_name
    document.title = title

    // Update favicon if provided
    if (settings.app_favicon_url) {
      let favicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      if (!favicon) {
        favicon = document.createElement('link')
        favicon.rel = 'icon'
        document.head.appendChild(favicon)
      }
      favicon.href = settings.app_favicon_url
    }

    // Update meta description if provided
    if (settings.app_description) {
      let metaDescription = document.querySelector("meta[name='description']") as HTMLMetaElement
      if (!metaDescription) {
        metaDescription = document.createElement('meta')
        metaDescription.name = 'description'
        document.head.appendChild(metaDescription)
      }
      metaDescription.content = settings.app_description
    }
  }, [settings, suffix])
}