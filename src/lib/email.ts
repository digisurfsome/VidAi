import { Resend } from 'resend'
import { supabase } from './supabase'

// For now, we'll use the fallback HTML template instead of React Email
// to avoid build configuration issues. React Email can be enabled later
// by uncommenting the imports and updating the createInvitationEmailHtml function

interface EmailSettings {
  senderName: string
  senderEmail: string
  resendApiKey: string
  domain?: string
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  replyTo?: string
}

export const getEmailSettings = async (userId: string): Promise<EmailSettings | null> => {
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

export const sendEmail = async (userId: string, options: SendEmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> => {
  try {
    const emailSettings = await getEmailSettings(userId)
    
    if (!emailSettings) {
      return {
        success: false,
        error: 'Email settings not configured. Please configure your email settings first.'
      }
    }

    const resend = new Resend(emailSettings.resendApiKey)

    const { data, error } = await resend.emails.send({
      from: `${emailSettings.senderName} <${emailSettings.senderEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      reply_to: options.replyTo || emailSettings.senderEmail,
    })

    if (error) {
      console.error('Resend API error:', error)
      return {
        success: false,
        error: error.message || 'Failed to send email'
      }
    }

    return {
      success: true,
      messageId: data?.id
    }
  } catch (error) {
    console.error('Email sending error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

export const createInvitationEmailHtml = (invitationData: {
  inviteeName: string
  inviterName: string
  organizationName?: string
  signUpUrl: string
  expiresAt?: Date
}): string => {
  // Use HTML template for now (React Email integration can be added later)
  const { inviteeName, inviterName, organizationName, signUpUrl, expiresAt } = invitationData
  
  const expirationText = expiresAt 
    ? `This invitation expires on ${expiresAt.toLocaleDateString('en-US', { 
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

export const sendInvitationEmail = async (
  userId: string,
  invitationData: {
    inviteeName: string
    inviterName: string
    organizationName?: string
    signUpUrl: string
    expiresAt?: Date
    recipientEmail: string
  }
): Promise<{ success: boolean; error?: string; messageId?: string }> => {
  try {
    console.log('Sending invitation email for user:', userId, 'to:', invitationData.recipientEmail)
    
    const { recipientEmail, ...emailData } = invitationData
    
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        recipientEmail,
        emailType: 'invitation',
        emailData
      })
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('API error during invitation:', result)
      return {
        success: false,
        error: result.error || 'Failed to send invitation email'
      }
    }

    console.log('Invitation email sent successfully:', result)
    return {
      success: true,
      messageId: result.messageId
    }
  } catch (error) {
    console.error('Invitation email error:', error)
    
    if (error instanceof Error) {
      return {
        success: false,
        error: `Error: ${error.message}`
      }
    }
    
    return {
      success: false,
      error: 'An unknown error occurred while sending the invitation email'
    }
  }
}

export const testEmailSettings = async (userId: string, testEmail: string): Promise<{ success: boolean; error?: string; messageId?: string }> => {
  try {
    console.log('Testing email settings for user:', userId, 'to:', testEmail)
    
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        recipientEmail: testEmail,
        emailType: 'test'
      })
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('API error during test:', result)
      return {
        success: false,
        error: result.error || 'Failed to send test email'
      }
    }

    console.log('Test email sent successfully:', result)
    return {
      success: true,
      messageId: result.messageId
    }
  } catch (error) {
    console.error('Email test error:', error)
    
    if (error instanceof Error) {
      return {
        success: false,
        error: `Error: ${error.message}`
      }
    }
    
    return {
      success: false,
      error: 'An unknown error occurred while sending the test email'
    }
  }
}

export const validateEmailSettings = (settings: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (!settings.sender_name?.trim()) {
    errors.push('Sender name is required')
  }
  
  if (!settings.sender_email?.trim()) {
    errors.push('Sender email is required')
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.sender_email)) {
    errors.push('Sender email must be a valid email address')
  }
  
  if (!settings.resend_api_key?.trim()) {
    errors.push('Resend API key is required')
  } else if (!settings.resend_api_key.startsWith('re_')) {
    errors.push('Resend API key must start with "re_"')
  }

  if (settings.sender_domain && !settings.sender_domain.includes('.')) {
    errors.push('Domain must be a valid domain name (e.g., yourdomain.com)')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}


export const checkEmailSettingsStatus = async (userId: string): Promise<{ 
  configured: boolean; 
  domainVerified: boolean; 
  error?: string 
}> => {
  try {
    const emailSettings = await getEmailSettings(userId)
    
    if (!emailSettings) {
      return { configured: false, domainVerified: false }
    }

    // Simple check: if no domain is specified, Resend's domain is used (always verified)
    // If a domain is specified, we assume it needs verification in Resend dashboard
    const domainVerified = !emailSettings.domain || emailSettings.domain.length === 0
    
    return {
      configured: true,
      domainVerified,
      error: undefined
    }
  } catch (error) {
    console.error('Error checking email settings status:', error)
    return {
      configured: false,
      domainVerified: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}