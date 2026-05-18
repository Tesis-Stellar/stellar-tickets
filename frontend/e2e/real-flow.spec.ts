import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RealE2EFixture = {
  password: string;
  customer: { id: string; email: string; role: string };
  staff: { id: string; email: string; role: string };
  event: { id: string; slug: string; title: string };
  ticketType: { id: string; name: string };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const backendDir = path.join(repoRoot, "backend");
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_API_PORT ?? "13000"}`;

test.skip(!process.env.E2E_REAL, "Activa E2E_REAL=1 para correr el flujo real contra backend y PostgreSQL.");
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

let fixture: RealE2EFixture;

function seedRealE2E(): RealE2EFixture {
  const output = execFileSync("npx", ["tsx", "scripts/seed-real-e2e.ts"], {
    cwd: backendDir,
    encoding: "utf8",
    env: {
      ...process.env,
      RUN_INDEXER: "false",
      ALLOW_LEGACY_TICKET_ID_SCAN: "true",
    },
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return JSON.parse(output) as RealE2EFixture;
}

async function login(page: Page, request: APIRequestContext, email: string, password: string) {
  const response = await request.post(`${apiBaseUrl}/api/auth/login`, {
    data: { email, password },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { accessToken: string };

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((accessToken) => window.localStorage.setItem("authToken", accessToken), body.accessToken);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("header").getByRole("link", { name: "Mi Cuenta" })).toBeVisible({ timeout: 45_000 });
}

async function getAuthToken(page: Page) {
  const token = await page.evaluate(() => window.localStorage.getItem("authToken"));
  expect(token).toBeTruthy();
  return token as string;
}

async function apiGet<T>(request: APIRequestContext, pathName: string, token: string): Promise<T> {
  const response = await request.get(`${apiBaseUrl}${pathName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

test.beforeAll(() => {
  fixture = seedRealE2E();
});

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
});

test("E2E-BUY-01 compra primaria simulada del prototipo y E2E-SCAN-01 scanner DB-first bloquea doble escaneo", async ({ page, request }) => {
  // E2E-BUY-01 valida la compra primaria simulada/off-chain del prototipo.
  // No se espera tx hash en este flujo. La redencion on-chain se valida en CONTRACT-REDEEM-01.
  await page.goto(`/evento/${fixture.event.id}/boletas`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main"), "event detail should finish loading for unauthenticated purchase guard").toContainText(
    fixture.event.title,
    { timeout: 45_000 },
  );
  await page.getByRole("button", { name: `Agregar ${fixture.ticketType.name}` }).click();
  await page.getByRole("button", { name: /Agregar al Carrito/i }).click();
  await page.waitForURL("**/login");

  await login(page, request, fixture.customer.email, fixture.password);

  await page.goto(`/evento/${fixture.event.id}/boletas`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main"), "event detail should finish loading for authenticated purchase").toContainText(
    fixture.event.title,
    { timeout: 45_000 },
  );
  await page.getByRole("button", { name: `Agregar ${fixture.ticketType.name}` }).click();
  const addToCartResponse = page.waitForResponse((response) =>
    response.url().includes("/api/cart/items") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Agregar al Carrito/i }).click();
  await expect((await addToCartResponse).status()).toBe(200);

  await page.waitForURL("**/carrito");
  await expect(page.getByText("Tu Carrito")).toBeVisible();
  await expect(page.getByText(fixture.event.title)).toBeVisible();
  await page.getByRole("link", { name: "Continuar al Checkout" }).click();

  await page.getByPlaceholder("Juan Pérez").fill("Cliente E2E");
  await page.getByPlaceholder("juan@email.com").fill(fixture.customer.email);
  await page.getByPlaceholder("3001234567").fill("3001112233");
  await page.getByPlaceholder("1020304050").fill("90011122");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel(/Acepto los/i).check();
  const checkoutResponse = page.waitForResponse((response) =>
    response.url().includes("/api/checkout/confirm") && response.request().method() === "POST",
    { timeout: 90_000 },
  );
  await page.getByRole("button", { name: /Confirmar compra/i }).click();
  await expect((await checkoutResponse).status()).toBe(200);

  await expect(page.getByText("Compra Simulada Exitosa")).toBeVisible();
  await page.getByRole("link", { name: "Ver Confirmación" }).click();
  await expect(page.getByText("¡Compra Confirmada!")).toBeVisible();
  await expect(page.getByText(fixture.event.title)).toBeVisible();

  await page.goto("/mi-cuenta/entradas", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(fixture.event.title)).toBeVisible();

  const customerToken = await getAuthToken(page);
  const tickets = await apiGet<Array<{ id: string; ticketCode?: string }>>(request, "/api/tickets", customerToken);
  const purchasedTicket = tickets.find((ticket) => ticket.id);
  expect(purchasedTicket?.id).toBeTruthy();

  await page.evaluate(() => window.localStorage.clear());
  await login(page, request, fixture.staff.email, fixture.password);
  const staffToken = await getAuthToken(page);
  const scanPayload = JSON.stringify({
    ticketId: purchasedTicket!.id,
    code: purchasedTicket!.ticketCode ?? "E2E-TICKET",
  });
  await page.evaluate((payload) => window.localStorage.setItem("e2eScanPayload", payload), scanPayload);

  await page.goto("/escanear", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Simular escaneo QA" }).click();
  await expect(page.getByText("Acceso Permitido")).toBeVisible();

  const duplicate = await request.post(`${apiBaseUrl}/api/admin/scan`, {
    headers: {
      Authorization: `Bearer ${staffToken}`,
      "Content-Type": "application/json",
    },
    data: { ticketId: purchasedTicket!.id },
  });
  expect(duplicate.status()).toBe(409);
  const duplicateBody = await duplicate.json();
  expect(duplicateBody.message).toBe("Boleto ya no esta activo: USED");
});
