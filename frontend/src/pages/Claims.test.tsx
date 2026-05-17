import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Claims from "./Claims";
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

vi.mock("@/components/layout/AccountSidebar", () => ({
  AccountSidebar: () => <nav data-testid="account-sidebar" />,
}));

const toast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const mockedUseAppContext = vi.mocked(useAppContext);

const ticket = {
  id: "ticket-1",
  ticketCode: "TK-QA-1",
  event: { id: "event-1", title: "Evento QA" },
  ticketType: { name: "General" },
};

function mockClaimsContext(apiFetch: ReturnType<typeof vi.fn>) {
  mockedUseAppContext.mockReturnValue({
    authStatus: "authenticated",
    isLoggedIn: true,
    purchasedTickets: [ticket],
    refreshTickets: vi.fn().mockResolvedValue(undefined),
    apiFetch,
  } as unknown as ReturnType<typeof useAppContext>);
}

describe("Claims page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the user claim history and shows the empty state", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    mockClaimsContext(apiFetch);

    render(
      <MemoryRouter>
        <Claims />
      </MemoryRouter>,
    );

    expect(screen.getByText("Cargando reclamos...")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No tienes reclamos")).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith("/api/claims");
  });

  it("creates a ticket claim with event evidence fields and reloads the history", async () => {
    const createdClaim = {
      id: "claim-1",
      type: "INVALID_QR",
      status: "OPEN",
      subject: "QR rechazado",
      description: "El QR fue rechazado en puerta.",
      ticketId: ticket.id,
      eventId: ticket.event.id,
      createdAt: "2026-05-17T12:00:00.000Z",
      updatedAt: "2026-05-17T12:00:00.000Z",
      messages: [],
    };
    const apiFetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(createdClaim)
      .mockResolvedValueOnce([createdClaim]);
    mockClaimsContext(apiFetch);

    render(
      <MemoryRouter>
        <Claims />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("No tienes reclamos")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Ticket relacionado"), { target: { value: ticket.id } });
    fireEvent.change(screen.getByLabelText("Asunto"), { target: { value: "QR rechazado" } });
    fireEvent.change(screen.getByLabelText("Descripción"), {
      target: { value: "El QR fue rechazado en puerta." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear reclamo" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/claims", {
      method: "POST",
      body: JSON.stringify({
        type: "INVALID_QR",
        ticketId: ticket.id,
        eventId: ticket.event.id,
        relatedTxHash: undefined,
        subject: "QR rechazado",
        description: "El QR fue rechazado en puerta.",
      }),
    });
    expect(toast).toHaveBeenCalledWith({
      title: "Reclamo creado",
      description: "Se guardó la evidencia técnica para revisión.",
    });
    expect(await screen.findByText("QR rechazado")).toBeInTheDocument();
    expect(screen.getByText("Abierto")).toBeInTheDocument();
  });

  it("requires a ticket or transaction hash before creating the claim", async () => {
    const apiFetch = vi.fn().mockResolvedValue([]);
    mockClaimsContext(apiFetch);

    render(
      <MemoryRouter>
        <Claims />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("No tienes reclamos")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Asunto"), { target: { value: "Necesito soporte" } });
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "No puedo completar el reporte." } });
    fireEvent.click(screen.getByRole("button", { name: "Crear reclamo" }));

    expect(toast).toHaveBeenCalledWith({
      title: "Asocia el reclamo",
      description: "Selecciona un ticket o agrega un hash de transacción relacionado.",
      variant: "destructive",
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
