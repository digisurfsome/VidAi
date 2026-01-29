import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

interface EmailSettings {
  senderName: string
  senderEmail: string
  resendApiKey: string
  domain?: string
}

const getEmailSettings = async (userId: string): Promise<EmailSettings | null> => {
  try {
    const { data: keys } = await supabase
      .from('user_api_keys')
      .select('key_name, key_value')
      .eq('user_id', userId)
      .in('key_name', ['sender_name', 'sender_email', 'resend_api_key', 'sender_domain'])

    if (!keys || keys.length === 0) {
      return null
    }

    const settings: Partial<EmailSettings> = {}
    keys.forEach(key => {
      switch (key.key_name) {
        case 'sender_name':
          settings.senderName = key.key_value
          break
        case 'sender_email':
          settings.senderEmail = key.key_value
          break
        case 'resend_api_key':
          settings.resendApiKey = key.key_value
          break
        case 'sender_domain':
          settings.domain = key.key_value
          break
      }
    })

    if (!settings.senderName || !settings.senderEmail || !settings.resendApiKey) {
      return null
    }

    return settings as EmailSettings
  } catch (error) {
    console.error('Error fetching email settings:', error)
    return null
  }
}

const createTestEmailHtml = (emailSettings: EmailSettings): string => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Test</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .container { background: white; border-radius: 8px; padding: 32px; border: 2px solid #10b981; }
    .header { text-align: center; margin-bottom: 24px; }
    .success-icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #065f46; margin: 0; font-size: 24px; }
    .info { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 6px; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="success-icon">✅</div>
      <h1>Email Configuration Test Successful!</h1>
    </div>
    
    <p>Congratulations! Your email settings are working correctly.</p>
    
    <div class="info">
      <strong>Configuration Details:</strong><br>
      • Sender: ${emailSettings.senderName} &lt;${emailSettings.senderEmail}&gt;<br>
      • Domain: ${emailSettings.domain || 'Resend default domain'}<br>
      • Test sent at: ${new Date().toLocaleString()}
    </div>
    
    <p>You can now send invitations and notifications with confidence. If you received this email, your domain verification and email settings are working perfectly!</p>
    
    <p style="color: #6b7280; font-size: 14px; margin-top: 24px; text-align: center;">
      This is a test email sent from your application's email settings.
    </p>
  </div>
</body>
</html>
  `.trim()
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Enable CORS for frontend
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { userId, testEmail } = req.body

    if (!userId || !testEmail) {
      return res.status(400).json({ error: 'Missing userId or testEmail' })
    }

    console.log('Testing email settings for user:', userId, 'to:', testEmail)
    
    const emailSettings = await getEmailSettings(userId)
    
    if (!emailSettings) {
      console.log('No email settings found')
      return res.status(400).json({ 
        error: 'Email settings not configured. Please configure your email settings first.' 
      })
    }

    console.log('Email settings found:', {
      senderName: emailSettings.senderName,
      senderEmail: emailSettings.senderEmail,
      hasApiKey: !!emailSettings.resendApiKey,
      domain: emailSettings.domain
    })

    const resend = new Resend(emailSettings.resendApiKey)

    // Send test email
    console.log('Attempting to send test email...')
    const { data, error } = await resend.emails.send({
      from: `${emailSettings.senderName} <${emailSettings.senderEmail}>`,
      to: testEmail,
      subject: 'Email Settings Test - Configuration Successful!',
      html: createTestEmailHtml(emailSettings),
    })

    if (error) {
      console.error('Resend API error during test:', error)
      return res.status(400).json({
        error: `Resend API Error: ${error.message || error.name || 'Failed to send test email'}`
      })
    }

    console.log('Test email sent successfully:', data)
    return res.status(200).json({
      success: true,
      messageId: data?.id
    })

  } catch (error) {
    console.error('Email test error:', error)
    
    if (error instanceof Error) {
      return res.status(500).json({
        error: `Error: ${error.message}`
      })
    }
    
    return res.status(500).json({
      error: 'An unknown error occurred while sending the test email'
    })
  }
}