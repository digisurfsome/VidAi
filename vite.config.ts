import { defineConfig, loadEnv } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import * as dotenv from 'dotenv';

// Load .env.local file for API endpoints
dotenv.config({ path: '.env.local' });

// Make env vars globally available for SSR modules
global.process = global.process || { env: {} };
Object.assign(global.process.env, process.env);

// API middleware plugin
const apiPlugin = () => {
  return {
    name: 'api-plugin',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        // Handle CORS preflight
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        // Map URL to API file
        const apiEndpoints = {
          '/send-email': 'send-email.ts',
          '/app-settings': 'app-settings.ts',
          '/admin-users': 'admin-users.ts',
          '/admin-credit-packages': 'admin-credit-packages.ts',
          '/credit-packages': 'credit-packages.ts',
          '/validate-fal-key': 'validate-fal-key.ts',
          '/generate-video': 'generate-video.ts',
          '/generations': 'generations.ts',
          '/credits': 'credits.ts',
          '/transactions': 'transactions.ts',
          '/stripe-admin': 'stripe-admin.ts',
          '/stripe-webhook': 'stripe-webhook-simple.ts',
          '/stripe-webhook-test': 'stripe-webhook-test.ts',
          '/stripe-checkout': 'stripe-checkout.ts',
          '/stripe-portal': 'stripe-portal.ts',
          '/credit-purchase': 'credit-purchase.ts',
          '/test-stripe-sync': 'test-stripe-sync.ts',
          '/stripe-checkout-new-user': 'stripe-checkout-new-user.ts',
          '/stripe-success-handler': 'stripe-success-handler.ts'
        };
        
        // Parse URL to get path without query parameters
        const urlPath = req.url?.split('?')[0];
        
        // Handle dynamic routes
        let apiFile = apiEndpoints[urlPath];
        if (!apiFile && urlPath?.startsWith('/generation-status/')) {
          apiFile = 'generation-status.ts';
        }
        if (!apiFile && urlPath?.startsWith('/stripe-admin/')) {
          apiFile = 'stripe-admin.ts';
        }
        
        if (!apiFile) {
          return next();
        }

        try {
          // Handle GET requests (no body parsing needed)
          if (req.method === 'GET') {
            // Parse query parameters
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const query = {};
            url.searchParams.forEach((value, key) => {
              query[key] = value;
            });
            
            const mockReq = {
              method: req.method,
              url: req.url,
              headers: req.headers,
              query: query,
              body: {}
            };

            const mockRes = {
              setHeader: (key, value) => res.setHeader(key, value),
              status: (code) => {
                res.statusCode = code;
                return mockRes;
              },
              json: (data) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              },
              redirect: (code, url) => {
                res.statusCode = code;
                res.setHeader('Location', url);
                res.end();
              },
              end: (data) => res.end(data)
            };

            const apiModule = await server.ssrLoadModule(`./api/${apiFile}`);
            await apiModule.default(mockReq, mockRes);
            return;
          }

          // Handle POST, PUT, DELETE requests (collect body data)
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });

            req.on('end', async () => {
              try {
                // Special handling for webhook endpoints - they need raw body
                const isWebhook = req.url === '/stripe-webhook';
                
                const mockReq = isWebhook ? {
                  method: req.method,
                  url: req.url,
                  headers: req.headers,
                  body: body, // Pass raw body string for webhooks
                  rawBody: body // Also provide it as rawBody for direct access
                } : {
                  method: req.method,
                  url: req.url,
                  headers: req.headers,
                  body: body ? JSON.parse(body) : {}
                };

                const mockRes = {
                  setHeader: (key, value) => res.setHeader(key, value),
                  status: (code) => {
                    res.statusCode = code;
                    return mockRes;
                  },
                  json: (data) => {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));
                  },
                  redirect: (code, url) => {
                    res.statusCode = code;
                    res.setHeader('Location', url);
                    res.end();
                  },
                  end: (data) => res.end(data)
                };

                const apiModule = await server.ssrLoadModule(`./api/${apiFile}`);
                await apiModule.default(mockReq, mockRes);
              } catch (error) {
                console.error('API error:', error);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Internal server error' }));
              }
            });
            return;
          }
        } catch (error) {
          console.error('API middleware error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    }
  };
};

export default defineConfig((config) => {
  const env = loadEnv(config.mode, process.cwd(), '');
  
  // Make environment variables available to the API functions
  process.env = { ...process.env, ...env };

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [apiPlugin(), dyadComponentTagger(), react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
