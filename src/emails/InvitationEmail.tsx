import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

interface InvitationEmailProps {
  inviteeName: string
  inviterName: string
  organizationName?: string
  signUpUrl: string
  expiresAt?: Date
}

export const InvitationEmail = ({
  inviteeName,
  inviterName,
  organizationName = "our platform",
  signUpUrl,
  expiresAt,
}: InvitationEmailProps) => {
  const previewText = `${inviterName} has invited you to join ${organizationName}`

  const expirationText = expiresAt
    ? `This invitation expires on ${expiresAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}.`
    : ''

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <div style={logoContainer}>
              <div style={logo}>🚀</div>
            </div>
            <Text style={headerTitle}>You're Invited!</Text>
            <Text style={headerSubtitle}>
              Join {organizationName} and start collaborating today
            </Text>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            <Text style={greeting}>Hi {inviteeName},</Text>
            
            <Text style={paragraph}>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{organizationName}</strong>. You'll have access to all the features 
              and can start collaborating with your team right away.
            </Text>

            <Text style={paragraph}>
              Click the button below to accept your invitation and create your account:
            </Text>

            {/* CTA Button */}
            <Section style={buttonContainer}>
              <Button href={signUpUrl} style={button}>
                Accept Invitation
              </Button>
            </Section>

            {/* Expiration Warning */}
            {expirationText && (
              <Section style={warningContainer}>
                <Text style={warningText}>⏰ {expirationText}</Text>
              </Section>
            )}

            <Text style={paragraph}>
              If you have any questions, feel free to reply to this email.
            </Text>

            <Text style={paragraph}>Welcome aboard!</Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              This invitation was sent by <strong>{inviterName}</strong>. 
              If you weren't expecting this invitation, you can safely ignore this email.
            </Text>
            
            <Text style={footerText}>
              If the button above doesn't work, you can copy and paste this link into your browser:
            </Text>
            
            <Link href={signUpUrl} style={footerLink}>
              {signUpUrl}
            </Link>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default InvitationEmail

// Styles
const main = {
  backgroundColor: '#f8fafc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
}

const container = {
  margin: '0 auto',
  padding: '20px 0 48px',
  maxWidth: '580px',
}

const header = {
  textAlign: 'center' as const,
  marginBottom: '32px',
}

const logoContainer = {
  margin: '0 auto 16px',
}

const logo = {
  width: '64px',
  height: '64px',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  borderRadius: '12px',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'white',
  fontWeight: 'bold',
  fontSize: '24px',
  textAlign: 'center' as const,
}

const headerTitle = {
  fontSize: '24px',
  fontWeight: '600',
  color: '#1e293b',
  margin: '0 0 8px 0',
}

const headerSubtitle = {
  fontSize: '16px',
  color: '#64748b',
  margin: '0 0 0 0',
}

const content = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '32px',
}

const greeting = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#1e293b',
  fontWeight: '600',
  margin: '0 0 16px 0',
}

const paragraph = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#374151',
  margin: '0 0 16px 0',
}

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
}

const button = {
  backgroundColor: '#6366f1',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
  border: 'none',
  cursor: 'pointer',
}

const warningContainer = {
  backgroundColor: '#fef3c7',
  border: '1px solid #fbbf24',
  borderRadius: '6px',
  padding: '16px',
  margin: '24px 0',
}

const warningText = {
  fontSize: '14px',
  color: '#92400e',
  margin: '0',
  textAlign: 'center' as const,
}

const divider = {
  borderColor: '#e2e8f0',
  margin: '32px 0',
}

const footer = {
  textAlign: 'center' as const,
}

const footerText = {
  fontSize: '14px',
  color: '#64748b',
  lineHeight: '20px',
  margin: '0 0 12px 0',
}

const footerLink = {
  fontSize: '14px',
  color: '#6366f1',
  textDecoration: 'underline',
  wordBreak: 'break-all' as const,
}