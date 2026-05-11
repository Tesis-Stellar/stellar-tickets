import { expect, test, type Page } from "@playwright/test";

const demoUser = {
  id: "user-demo-qa",
  firstName: "Ana",
  lastName: "QA",
  email: "ana.qa@example.com",
  phone: "3001234567",
  documentType: "CC",
  documentNumber: "1020304050",
  walletAddress: null,
  role: "STAFF",
};

const demoEvent = {
  id: "demo-event",
  slug: "demo-event",
  title: "Concierto QA Controlado",
  description: "Evento estable para el E2E de la demo.",
  category: "Conciertos",
  categoryLabel: "Conciertos",
  city: "Bogotá",
  organizer: "Stellar Tickets QA",
  venue: { name: "Teatro QA" },
  startsAt: "2026-06-15T20:00:00.000Z",
  eventTime: "20:00",
  isFeatured: true,
  hasSeatSelection: false,
  minPrice: { amount: 50000 },
  posterImage: "https://placehold.co/800x500?text=QA",
  bannerImage: "https://placehold.co/1200x400?text=QA",
};

const ticketType = {
  id: "ticket-general-qa",
  name: "General QA",
  price: 50000,
  serviceFee: 5000,
  availability: 25,
  maxPerOrder: 4,
};

const purchasedTicket = {
  id: "ticket-issued-qa",
  quantity: 1,
  purchasedAt: "2026-05-11T16:00:00.000Z",
  ticketType: {
    id: ticketType.id,
    name: ticketType.name,
    price: ticketType.price,
    serviceFee: ticketType.serviceFee,
  },
  event: {
    id: demoEvent.id,
    slug: demoEvent.slug,
    title: demoEvent.title,
    category: demoEvent.category,
    city: demoEvent.city,
    venue: demoEvent.venue,
    organizer: demoEvent.organizer,
    description: demoEvent.description,
    startsAt: demoEvent.startsAt,
    eventTime: demoEvent.eventTime,
    posterImage: demoEvent.posterImage,
    bannerImage: demoEvent.bannerImage,
  },
  qrPayload: JSON.stringify({ qrToken: "signed-demo-token" }),
};

const confirmedOrder = {
  id: "order-demo-qa",
  orderNumber: "ORD-DEMO-QA",
  buyerEmail: demoUser.email,
  buyerPhone: demoUser.phone,
  buyerDocument: "CC 1020304050",
  subtotal: 50000,
  serviceFees: 5000,
  total: 55000,
  status: "CONFIRMED",
  createdAt: "2026-05-11T16:00:00.000Z",
  items: [purchasedTicket],
};

async function mockDemoApi(page: Page) {
  let cartItems: unknown[] = [];
  let orders = [confirmedOrder];
  let tickets: unknown[] = [];

  await page.route("http://127.0.0.1:3000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (method === "POST" && path === "/api/auth/login") {
      return json({ accessToken: "demo-token", user: demoUser });
    }
    if (method === "GET" && path === "/api/users/me") {
      return json(demoUser);
    }
    if (method === "GET" && path === "/api/events") {
      return json({ data: [demoEvent] });
    }
    if (method === "GET" && path === "/api/events/featured") {
      return json([demoEvent]);
    }
    if (method === "GET" && path === `/api/events/${demoEvent.id}/ticket-types`) {
      return json([ticketType]);
    }
    if (method === "GET" && path === "/api/cart") {
      return json(cartItems);
    }
    if (method === "POST" && path === "/api/cart/items") {
      cartItems = [
        {
          id: "cart-item-demo-qa",
          quantity: 1,
          ticketType: {
            id: ticketType.id,
            name: ticketType.name,
            price: ticketType.price,
            serviceFee: ticketType.serviceFee,
          },
          event: purchasedTicket.event,
        },
      ];
      return json({ id: "cart-item-demo-qa" });
    }
    if (method === "POST" && path === "/api/checkout/preview") {
      return json({ subtotal: 50000, serviceFees: 5000, total: 55000, itemCount: 1 });
    }
    if (method === "POST" && path === "/api/checkout/confirm") {
      cartItems = [];
      orders = [confirmedOrder];
      tickets = [purchasedTicket];
      return json(confirmedOrder);
    }
    if (method === "GET" && path === "/api/orders") {
      return json(orders);
    }
    if (method === "GET" && path === `/api/orders/${confirmedOrder.id}`) {
      return json(confirmedOrder);
    }
    if (method === "GET" && path === "/api/tickets") {
      return json(tickets);
    }
    if (method === "GET" && path === "/api/tickets/sold") {
      return json([]);
    }
    if (method === "POST" && path === "/api/admin/scan") {
      return json({ success: true, ticketId: purchasedTicket.id, result: "ACCEPTED" });
    }

    return json({ code: "NOT_MOCKED", message: `${method} ${path}` }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  await mockDemoApi(page);
});

test("demo controlado: login, compra, entradas y scanner sin Freighter real", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("tu@email.com").fill(demoUser.email);
  await page.getByPlaceholder("••••••••").fill("demo1234");
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page.getByRole("heading", { name: "Mi Cuenta" })).toBeVisible();

  await page.goto(`/evento/${demoEvent.id}/boletas`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Agregar ${ticketType.name}` }).click();
  await page.getByRole("button", { name: /Agregar al Carrito/i }).click();

  await expect(page.getByText("Tu Carrito")).toBeVisible();
  await expect(page.getByText(demoEvent.title)).toBeVisible();
  await page.getByRole("link", { name: "Continuar al Checkout" }).click();

  await page.getByPlaceholder("Juan Pérez").fill("Ana QA");
  await page.getByPlaceholder("juan@email.com").fill(demoUser.email);
  await page.getByPlaceholder("3001234567").fill(demoUser.phone);
  await page.getByPlaceholder("1020304050").fill(demoUser.documentNumber);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel(/Acepto los/i).check();
  await page.getByRole("button", { name: /Confirmar compra simulada/i }).click();

  await expect(page.getByText("Compra Simulada Exitosa")).toBeVisible();
  await page.getByRole("link", { name: "Ver Confirmación" }).click();
  await expect(page.getByText("¡Compra Confirmada!")).toBeVisible();
  await expect(page.getByText("ORD-DEMO-QA")).toBeVisible();
  await expect(page.getByText(ticketType.name, { exact: false })).toBeVisible();

  await page.goto("/mi-cuenta/entradas", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(demoEvent.title)).toBeVisible();

  await page.evaluate(() => {
    window.localStorage.setItem("e2eScanPayload", JSON.stringify({ qrToken: "signed-demo-token" }));
  });
  await page.goto("/escanear", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Simular escaneo QA" }).click();
  await expect(page.getByText("Acceso Permitido")).toBeVisible();
});
