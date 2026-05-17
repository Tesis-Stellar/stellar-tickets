import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TicketCard } from "./TicketCard";
import { useAppContext } from "@/context/AppContext";

vi.mock("@/context/AppContext", () => ({
  useAppContext: vi.fn(),
}));

const toast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/hooks/useXlmPrice", () => ({
  useXlmPrice: () => 1200,
  formatCOP: (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`,
}));

vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => <canvas data-testid="qr" />,
}));

const mockedUseAppContext = vi.mocked(useAppContext);

const ticket = {
  id: "ticket-1",
  ticketCode: "TK-1",
  quantity: 1,
  purchasedAt: "2026-05-17T12:00:00.000Z",
  isSecuredOnChain: true,
  isForSale: false,
  contractAddress: "C_EVENT",
  ticketRootId: 1,
  version: 0,
  ownerWallet: "GOWNER",
  event: {
    id: "event-1",
    title: "Evento QA",
    image: "https://example.com/event.jpg",
    date: "17",
    month: "MAY",
    year: "2026",
    time: "08:00 p. m.",
    venue: { name: "Teatro QA" },
    city: "Medellín",
  },
  ticketType: {
    id: "tt-1",
    name: "General",
    price: 1000,
    serviceFee: 100,
  },
};

function mockTicketContext(overrides: Partial<ReturnType<typeof useAppContext>> = {}) {
  mockedUseAppContext.mockReturnValue({
    walletAddress: "GOWNER",
    secureTicketOnChain: vi.fn(),
    cancelResaleListing: vi.fn(),
    getTicketResalePolicy: vi.fn().mockResolvedValue({
      canList: true,
      ticketStatus: "ACTIVE",
      isForSale: false,
      policy: {
        enabled: true,
        limitType: "PERCENTAGE",
        originalPriceAmount: 1000,
        maxPriceAmount: 1500,
        maxPricePercent: 150,
        resaleStartsAt: null,
        resaleEndsAt: null,
        resaleDeadline: null,
        blockHoursBeforeEvent: 6,
        platformFeePercent: 3,
        organizerFeePercent: 5,
        sellerReceivesPercent: 92,
      },
    }),
    listTicketForSale: vi.fn().mockResolvedValue({
      success: false,
      error: "Freighter rechazó la firma",
    }),
    ...overrides,
  } as unknown as ReturnType<typeof useAppContext>);
}

describe("TicketCard resale UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a clear toast when Freighter or blockchain signing rejects the resale listing", async () => {
    mockTicketContext();

    render(<TicketCard ticket={ticket as any} />);

    fireEvent.click(screen.getByRole("button", { name: "Vender boleta" }));
    await waitFor(() => expect(screen.getByText("Listar boleto en reventa")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Precio en COP"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Listar por $1.200" }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "No se pudo publicar la reventa",
        description: "Freighter rechazó la firma",
        variant: "destructive",
      });
    });
  });

  it("does not open resale when the ticket violates the event policy", async () => {
    mockTicketContext({
      getTicketResalePolicy: vi.fn().mockResolvedValue({
        canList: false,
        reason: "La reventa está deshabilitada para este evento",
        ticketStatus: "ACTIVE",
        isForSale: false,
        policy: null,
      }),
    });

    render(<TicketCard ticket={ticket as any} />);

    fireEvent.click(screen.getByRole("button", { name: "Vender boleta" }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        title: "Reventa no permitida",
        description: "La reventa está deshabilitada para este evento",
        variant: "destructive",
      });
    });
    expect(screen.queryByText("Listar boleto en reventa")).not.toBeInTheDocument();
  });
});
