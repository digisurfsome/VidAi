import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function TestAuthCallback() {
  const [status, setStatus] = useState('Initializing...')
  const [logs, setLogs] = useState<string[]>([])
  
  const addLog = (message: string) => {
    console.log(message)
    setLogs(prev => [...prev, `${new Date().toISOString()}: ${message}`])
  }

  useEffect(() => {
    const testAuth = async () => {
      addLog('TestAuthCallback mounted')
      
      // Check URL params
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')
      addLog(`URL code parameter: ${code}`)
      
      // Check if we have a session already
      const { data: { session: existingSession }, error: sessionError } = await supabase.auth.getSession()
      addLog(`Existing session: ${existingSession ? 'YES' : 'NO'}`)
      if (sessionError) {
        addLog(`Session error: ${sessionError.message}`)
      }
      
      if (existingSession) {
        setStatus('Session exists! Redirecting...')
        addLog('Found existing session, would redirect to /auth/update-password')
        // window.location.href = '/auth/update-password'
        return
      }
      
      // Listen for auth state changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        addLog(`Auth state change: ${event}, session: ${session ? 'YES' : 'NO'}`)
        if (event === 'SIGNED_IN' && session) {
          setStatus('SIGNED_IN! Would redirect...')
          addLog('SIGNED_IN event received, would redirect to /auth/update-password')
          // window.location.href = '/auth/update-password'
        }
      })
      
      // Try to manually exchange the code if we have one
      if (code) {
        addLog('Attempting manual code exchange...')
        try {
          // Get the code verifier from storage
          const storedVerifier = sessionStorage.getItem('supabase.auth.pkce.code_verifier')
          addLog(`Stored PKCE verifier: ${storedVerifier ? 'EXISTS' : 'NOT FOUND'}`)
          
          // Check if Supabase is already processing
          const authUrl = new URL(window.location.href)
          if (authUrl.searchParams.has('code')) {
            addLog('Code is in URL, Supabase should auto-exchange it')
            setStatus('Waiting for Supabase auto-exchange...')
            
            // Wait a bit and check again
            setTimeout(async () => {
              const { data: { session: newSession } } = await supabase.auth.getSession()
              addLog(`Session after wait: ${newSession ? 'YES' : 'NO'}`)
              if (newSession) {
                setStatus('Session established after wait!')
                addLog('Session found after waiting, would redirect')
              } else {
                setStatus('No session after wait - exchange may have failed')
                addLog('No session after waiting')
              }
            }, 2000)
          }
        } catch (error: any) {
          addLog(`Exchange error: ${error.message}`)
          setStatus(`Error: ${error.message}`)
        }
      } else {
        setStatus('No code in URL')
        addLog('No code parameter in URL')
      }
      
      return () => {
        subscription.unsubscribe()
      }
    }
    
    testAuth()
  }, [])

  const manualRedirect = () => {
    window.location.href = '/auth/update-password'
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Auth Callback</h1>
      <div className="mb-4">
        <p className="text-lg">Status: {status}</p>
      </div>
      <div className="mb-4">
        <Button onClick={manualRedirect}>Manual Redirect to Update Password</Button>
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Logs:</h2>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded max-h-96 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="text-sm font-mono">{log}</div>
          ))}
        </div>
      </div>
    </div>
  )
}