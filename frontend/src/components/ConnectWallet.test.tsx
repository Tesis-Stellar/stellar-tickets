import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectWallet } from "./ConnectWallet";
import { useAppContext } from "@/context/AppContext";

vi.mock("@/context/AppContext", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useXlmPrice", () => ({
  useXlmPrice: () => null,
  formatCOP: (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`,
}));

const mockedUseAppContext = vi.mocked(useAppContext);

const baseContext = {
  walletAddress: null,
  setWalletAddress: vi.fn(),
  linkWallet: vi.fn(),
  isLoggedIn: true,
  balanceVersion: 0,
  user: {
    id: "user-qa",
    name: "Usuario QA",
    email: "qa@example.com",
    role: "CUSTOMER",
  },
};

describe("ConnectWallet role visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the linked wallet for customer users", () => {
    mockedUseAppContext.mockReturnValue({
      ...baseContext,
      walletAddress: "GC5DPWEAIL6KIPBB7D7NGSAGKTUFEBJATSZVVQLCZ2SVLT2RR3HJOFDQ",
    } as ReturnType<typeof useAppContext>);

    render(<ConnectWallet />);

    expect(screen.getByText("GC5D...OFDQ")).toBeInTheDocument();
  });

  it.each(["ADMIN", "STAFF"])("hides wallet controls for %s users", (role) => {
    mockedUseAppContext.mockReturnValue({
      ...baseContext,
      walletAddress: "GC5DPWEAIL6KIPBB7D7NGSAGKTUFEBJATSZVVQLCZ2SVLT2RR3HJOFDQ",
      user: { ...baseContext.user, role },
    } as ReturnType<typeof useAppContext>);

    const { container } = render(<ConnectWallet />);

    expect(container).toBeEmptyDOMElement();
    expect(baseContext.setWalletAddress).toHaveBeenCalledWith(null);
  });
});
