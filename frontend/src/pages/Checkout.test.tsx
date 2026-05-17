import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Checkout from "./Checkout";
import { useAppContext } from "@/context/AppContext";

vi.mock("@/context/AppContext", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => <div data-testid="footer" />,
}));

vi.mock("@/components/ui/CheckoutStepper", () => ({
  CheckoutStepper: ({ currentStep }: { currentStep: number }) => <div data-testid="stepper">Paso {currentStep}</div>,
}));

const mockedUseAppContext = vi.mocked(useAppContext);

const cart = [
  {
    id: "cart-1",
    quantity: 1,
    ticketType: { id: "tt-1", name: "General", price: 1000, serviceFee: 100 },
    event: { id: "event-1", title: "Evento QA" },
  },
];

function renderCheckout(checkout = vi.fn().mockResolvedValue({ id: "order-1" })) {
  mockedUseAppContext.mockReturnValue({
    authStatus: "authenticated",
    isLoggedIn: true,
    user: { id: "user-1", role: "CUSTOMER" },
    cart,
    checkout,
  } as unknown as ReturnType<typeof useAppContext>);

  render(
    <MemoryRouter>
      <Checkout />
    </MemoryRouter>,
  );
  return { checkout };
}

async function fillBuyerStep() {
  fireEvent.change(screen.getByPlaceholderText("Juan Pérez"), { target: { value: "Cliente QA" } });
  fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "cliente@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("3001234567"), { target: { value: "3001234567" } });
  fireEvent.change(screen.getByPlaceholderText("1020304050"), { target: { value: "1020304050" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await waitFor(() => expect(screen.getByTestId("stepper")).toHaveTextContent("Paso 2"));
}

describe("Checkout page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a visible checkout API error without navigating to success", async () => {
    const checkout = vi.fn().mockRejectedValue(new Error("La reserva de uno o más asientos expiró"));
    renderCheckout(checkout);

    await fillBuyerStep();
    fireEvent.click(screen.getByLabelText(/Acepto los/i));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar compra simulada/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("La reserva de uno o más asientos expiró"));
    expect(screen.queryByText("Compra Simulada Exitosa")).not.toBeInTheDocument();
    expect(checkout).toHaveBeenCalledTimes(1);
  });

  it("disables the confirmation button and writes the loading state while checkout is pending", async () => {
    let resolveCheckout: (value: { id: string }) => void = () => undefined;
    const checkout = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveCheckout = resolve;
    }));
    renderCheckout(checkout);

    await fillBuyerStep();
    fireEvent.click(screen.getByLabelText(/Acepto los/i));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar compra simulada/i }));

    const pendingButton = await screen.findByRole("button", { name: /Confirmando/i });
    expect(pendingButton).toBeDisabled();
    resolveCheckout({ id: "order-1" });
    await waitFor(() => expect(screen.getByText("Compra Simulada Exitosa")).toBeInTheDocument());
  });
});
