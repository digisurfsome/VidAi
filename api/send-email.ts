import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.")
}

// Use service role key to bypass RLS when querying user settings
const supabase = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : createClient(supabaseUrl, supabaseAnonKey)

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

const createInvitationEmailHtml = (invitationData: {
  inviteeName: string
  inviterName: string
  organizationName?: string
  signUpUrl: string
  expiresAt?: Date
}): string => {
  const { inviteeName, inviterName, organizationName, signUpUrl, expiresAt } = invitationData
  
  const expirationText = expiresAt 
    ? `This invitation expires on ${new Date(expiresAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}.`
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited!</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      border-radius: 12px;
      margin: 0 auto 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 24px;
    }
    h1 {
      color: #1e293b;
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      margin-bottom: 32px;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      padding: 12px 32px;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin: 16px 0;
      text-align: center;
    }
    .footer {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 14px;
      text-align: center;
    }
    .expiration {
      background: #fef3c7;
      border: 1px solid #fbbf24;
      padding: 12px;
      border-radius: 6px;
      margin: 16px 0;
      color: #92400e;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        🚀
      </div>
      <h1>You're Invited${organizationName ? ` to ${organizationName}` : ''}!</h1>
    </div>
    
    <div class="content">
      <p>Hi ${inviteeName},</p>
      
      <p>${inviterName} has invited you to join${organizationName ? ` ${organizationName}` : ' our platform'}. You'll have access to all the features and can start collaborating right away.</p>
      
      <p>Click the button below to accept your invitation and create your account:</p>
      
      <div style="text-align: center;">
        <a href="${signUpUrl}" class="button">Accept Invitation</a>
      </div>
      
      ${expirationText ? `<div class="expiration">⏰ ${expirationText}</div>` : ''}
      
      <p>If you have any questions, feel free to reply to this email.</p>
      
      <p>Welcome aboard!</p>
    </div>
    
    <div class="footer">
      <p>This invitation was sent by ${inviterName}. If you weren't expecting this invitation, you can safely ignore this email.</p>
      <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #6366f1;">${signUpUrl}</p>
    </div>
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
    const { userId, recipientEmail, emailType, emailData } = req.body

    if (!userId || !recipientEmail || !emailType) {
      return res.status(400).json({ error: 'Missing required fields: userId, recipientEmail, emailType' })
    }

    console.log(`Processing ${emailType} email for user:`, userId, 'to:', recipientEmail)
    
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

    let emailHtml: string
    let subject: string

    switch (emailType) {
      case 'test':
        emailHtml = createTestEmailHtml(emailSettings)
        subject = 'Email Settings Test - Configuration Successful!'
        break
        
      case 'invitation':
        if (!emailData) {
          return res.status(400).json({ error: 'emailData is required for invitation emails' })
        }
        emailHtml = createInvitationEmailHtml(emailData)
        subject = `You're invited to join ${emailData.organizationName || 'our platform'}!`
        break
        
      default:
        return res.status(400).json({ error: 'Invalid emailType. Must be "test" or "invitation"' })
    }

    // Send email
    console.log('Attempting to send email...')
    const { data, error } = await resend.emails.send({
      from: `${emailSettings.senderName} <${emailSettings.senderEmail}>`,
      to: recipientEmail,
      subject: subject,
      html: emailHtml,
    })

    if (error) {
      console.error('Resend API error:', error)
      return res.status(400).json({
        error: `Resend API Error: ${error.message || error.name || 'Failed to send email'}`
      })
    }

    console.log('Email sent successfully:', data)
    return res.status(200).json({
      success: true,
      messageId: data?.id
    })

  } catch (error) {
    console.error('Email sending error:', error)
    
    if (error instanceof Error) {
      return res.status(500).json({
        error: `Error: ${error.message}`
      })
    }
    
    return res.status(500).json({
      error: 'An unknown error occurred while sending the email'
    })
  }
}