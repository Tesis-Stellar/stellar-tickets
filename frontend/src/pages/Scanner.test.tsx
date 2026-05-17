import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScannerPage } from "./Scanner";
import { useAppContext } from "@/context/AppContext";

vi.mock("@/context/AppContext", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@yudiel/react-qr-scanner", () => ({
  Scanner: ({ onScan }: { onScan: (codes: Array<{ rawValue: string }>) => void }) => (
    <button
      type="button"
      onClick={() => onScan([{ rawValue: JSON.stringify({ qrToken: "signed-token" }) }])}
    >
      Escanear QR mock
    </button>
  ),
}));

const mockedUseAppContext = vi.mocked(useAppContext);

const staffContext = {
  authStatus: "authenticated",
  user: {
    id: "staff-1",
    name: "Staff QA",
    email: "staff@example.com",
    role: "STAFF",
  },
};

describe("ScannerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a successful gate validation for a signed QR", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ success: true });
    mockedUseAppContext.mockReturnValue({
      ...staffContext,
      apiFetch,
    } as ReturnType<typeof useAppContext>);

    render(
      <MemoryRouter>
        <ScannerPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Escanear QR mock"));

    await waitFor(() => expect(screen.getByText("Acceso Permitido")).toBeInTheDocument());
    expect(screen.getByText("Entrada validada: QR firmado")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/admin/scan", {
      method: "POST",
      body: JSON.stringify({ qrToken: "signed-token" }),
    });
  });

  it("shows the API denial reason when a scanned ticket is stale or already used", async () => {
    const apiFetch = vi.fn().mockRejectedValue(new Error("Boleto ya no esta activo: USED"));
    mockedUseAppContext.mockReturnValue({
      ...staffContext,
      apiFetch,
    } as ReturnType<typeof useAppContext>);

    render(
      <MemoryRouter>
        <ScannerPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Escanear QR mock"));

    await waitFor(() => expect(screen.getByText("Acceso Denegado")).toBeInTheDocument());
    expect(screen.getByText("Boleto ya no esta activo: USED")).toBeInTheDocument();
  });

  it("renders the auth hydration state before deciding route access", () => {
    mockedUseAppContext.mockReturnValue({
      authStatus: "checking",
      user: null,
      apiFetch: vi.fn(),
    } as unknown as ReturnType<typeof useAppContext>);

    render(
      <MemoryRouter>
        <ScannerPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Cargando sesión...")).toBeInTheDocument();
  });
});
