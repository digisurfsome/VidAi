import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import GeneratePage from './GeneratePage';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';

// Mock the auth context
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn()
}));

// Mock the useCredits hook
vi.mock('@/hooks/useCredits', () => ({
  useCredits: vi.fn()
}));

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              data: [],
              error: null
            }))
          }))
        }))
      }))
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({
        data: { session: { access_token: 'test-token' } }
      }))
    }
  }
}));

// Mock fal-client
vi.mock('@/lib/fal-client', () => ({
  getAvailableModels: vi.fn(() => [
    { id: 'fal-ai/minimax-video', name: 'MiniMax Video', description: 'Standard video generation' },
    { id: 'fal-ai/wan-t2v', name: 'WAN T2V', description: 'Text to video' }
  ])
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('GeneratePage - Credit Validation', () => {
  const mockUser = { id: 'test-user-id', email: 'test@example.com' };
  
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ user: mockUser });
  });

  describe('Credit Balance Checks', () => {
    it('should disable generate button when user has 0 credits', async () => {
      (useCredits as any).mockReturnValue({
        balance: 0,
        loading: false,
        error: null,
        canAfford: vi.fn(() => false),
        checkSufficientCredits: vi.fn(() => Promise.resolve(false)),
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      const Wrapper = createWrapper();
      render(<GeneratePage />, { wrapper: Wrapper });

      await waitFor(() => {
        const generateButton = screen.getByRole('button', { name: /generate video/i });
        expect(generateButton).toBeDisabled();
      });
    });

    it('should enable generate button when user has sufficient credits', async () => {
      (useCredits as any).mockReturnValue({
        balance: 10,
        loading: false,
        error: null,
        canAfford: vi.fn(() => true),
        checkSufficientCredits: vi.fn(() => Promise.resolve(true)),
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      const Wrapper = createWrapper();
      render(<GeneratePage />, { wrapper: Wrapper });

      await waitFor(() => {
        const generateButton = screen.getByRole('button', { name: /generate video/i });
        expect(generateButton).not.toBeDisabled();
      });
    });

    it('should show loading state during credit validation', async () => {
      (useCredits as any).mockReturnValue({
        balance: 0,
        loading: true,
        error: null,
        canAfford: vi.fn(() => false),
        checkSufficientCredits: vi.fn(() => Promise.resolve(false)),
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      const Wrapper = createWrapper();
      render(<GeneratePage />, { wrapper: Wrapper });

      // During loading, button should be disabled
      const generateButton = screen.getByRole('button', { name: /generate video/i });
      expect(generateButton).toBeDisabled();
    });
  });

  describe('Credit Validation on Form Submit', () => {
    it('should check credits before generation', async () => {
      const checkSufficientCreditsMock = vi.fn(() => Promise.resolve(true));
      const deductForGenerationMock = vi.fn(() => Promise.resolve(true));

      (useCredits as any).mockReturnValue({
        balance: 10,
        loading: false,
        error: null,
        canAfford: vi.fn(() => true),
        checkSufficientCredits: checkSufficientCreditsMock,
        deductForGeneration: deductForGenerationMock,
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      const Wrapper = createWrapper();
      render(<GeneratePage />, { wrapper: Wrapper });

      // Fill in the form
      const promptInput = screen.getByPlaceholderText(/cinematic shot/i);
      fireEvent.change(promptInput, { target: { value: 'A beautiful landscape with mountains' } });

      // Submit the form
      const generateButton = screen.getByRole('button', { name: /generate video/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(checkSufficientCreditsMock).toHaveBeenCalled();
      });
    });

    it('should prevent generation if insufficient credits', async () => {
      const checkSufficientCreditsMock = vi.fn(() => Promise.resolve(false));
      
      (useCredits as any).mockReturnValue({
        balance: 0,
        loading: false,
        error: null,
        canAfford: vi.fn(() => false),
        checkSufficientCredits: checkSufficientCreditsMock,
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      const Wrapper = createWrapper();
      render(<GeneratePage />, { wrapper: Wrapper });

      // Try to generate with 0 credits
      const generateButton = screen.getByRole('button', { name: /generate video/i });
      expect(generateButton).toBeDisabled();
    });
  });

  describe('Credit Display', () => {
    it('should show insufficient credits message when balance is 0', async () => {
      (useCredits as any).mockReturnValue({
        balance: 0,
        loading: false,
        error: null,
        canAfford: vi.fn(() => false),
        checkSufficientCredits: vi.fn(() => Promise.resolve(false)),
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      const Wrapper = createWrapper();
      render(<GeneratePage />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/insufficient credits/i)).toBeInTheDocument();
      });
    });

    it('should update button state when credits change', async () => {
      const { rerender } = render(<GeneratePage />, { wrapper: createWrapper() });

      // Initially with credits
      (useCredits as any).mockReturnValue({
        balance: 10,
        loading: false,
        error: null,
        canAfford: vi.fn(() => true),
        checkSufficientCredits: vi.fn(() => Promise.resolve(true)),
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      rerender(<GeneratePage />);

      let generateButton = screen.getByRole('button', { name: /generate video/i });
      expect(generateButton).not.toBeDisabled();

      // Update to 0 credits
      (useCredits as any).mockReturnValue({
        balance: 0,
        loading: false,
        error: null,
        canAfford: vi.fn(() => false),
        checkSufficientCredits: vi.fn(() => Promise.resolve(false)),
        deductForGeneration: vi.fn(),
        refundForFailure: vi.fn(),
        refreshBalance: vi.fn(),
        getCost: vi.fn(() => 1),
        transactions: []
      });

      rerender(<GeneratePage />);

      generateButton = screen.getByRole('button', { name: /generate video/i });
      expect(generateButton).toBeDisabled();
    });
  });
});