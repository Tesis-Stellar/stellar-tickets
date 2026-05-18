import { expect, test, type Page } from "@playwright/test";

test.skip(Boolean(process.env.E2E_REAL), "La suite E2E real usa backend y PostgreSQL sin mocks.");

const demoCustomer = {
  id: "user-demo-customer",
  firstName: "Ana",
  lastName: "Cliente",
  email: "ana.cliente@example.com",
  phone: "3001234567",
  documentType: "CC",
  documentNumber: "1020304050",
  walletAddress: "GC5DPWEAIL6KIPBB7D7NGSAGKTUFEBJATSZVVQLCZ2SVLT2RR3HJOFDQ",
  role: "CUSTOMER",
};

const demoStaff = {
  id: "user-demo-staff",
  firstName: "Sara",
  lastName: "Staff",
  email: "sara.staff@example.com",
  phone: "3007654321",
  documentType: "CC",
  documentNumber: "2030405060",
  walletAddress: null,
  role: "STAFF",
};

const demoAdmin = {
  id: "user-demo-admin",
  firstName: "Juan",
  lastName: "Admin",
  email: "juan.admin@example.com",
  phone: "3009999999",
  documentType: "CC",
  documentNumber: "3040506070",
  walletAddress: null,
  role: "ADMIN",
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

const seatedEvent = {
  ...demoEvent,
  id: "seated-event",
  slug: "seated-event",
  title: "Estadio QA Operativo",
  venue: { name: "Estadio QA" },
  venueType: "STADIUM",
  hasSeatSelection: true,
};

const ticketType = {
  id: "ticket-general-qa",
  name: "General QA",
  price: 50000,
  serviceFee: 5000,
  availability: 25,
  maxPerOrder: 4,
};

const seatedTicketType = {
  id: "ticket-seated-qa",
  name: "Platea QA",
  price: 70000,
  serviceFee: 7000,
  availability: 20,
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
  buyerEmail: demoCustomer.email,
  buyerPhone: demoCustomer.phone,
  buyerDocument: "CC 1020304050",
  subtotal: 50000,
  serviceFees: 5000,
  total: 55000,
  status: "CONFIRMED",
  createdAt: "2026-05-11T16:00:00.000Z",
  items: [purchasedTicket],
};

const seatedResponse = {
  venueType: "STADIUM",
  venueName: "Estadio QA",
  sections: [
    {
      id: "section-platea",
      name: "Platea",
      ticketTypeId: seatedTicketType.id,
      price: seatedTicketType.price,
      serviceFee: seatedTicketType.serviceFee,
      maxPerOrder: seatedTicketType.maxPerOrder,
      seats: [
        { seatId: "seat-a1", label: "A1", row: "A", number: 1, status: "AVAILABLE" },
        { seatId: "seat-a2", label: "A2", row: "A", number: 2, status: "SOLD" },
        { seatId: "seat-a3", label: "A3", row: "A", number: 3, status: "HELD" },
        { seatId: "seat-b1", label: "B1", row: "B", number: 1, status: "BLOCKED" },
      ],
    },
  ],
};

async function mockDemoApi(page: Page) {
  let currentUser = demoCustomer;
  let cartItems: unknown[] = [];
  let orders = [confirmedOrder];
  let tickets: unknown[] = [];
  let scanAttempts = 0;
  const events = [demoEvent, seatedEvent];

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
      const body = request.postDataJSON() as { email?: string };
      currentUser =
        body.email === demoAdmin.email ? demoAdmin :
        body.email === demoStaff.email ? demoStaff :
        demoCustomer;
      return json({ accessToken: `${currentUser.role.toLowerCase()}-demo-token`, user: currentUser });
    }
    if (method === "GET" && path === "/api/users/me") {
      return json(currentUser);
    }
    if (method === "GET" && path === "/api/events") {
      return json({ data: events });
    }
    if (method === "GET" && path === "/api/events/featured") {
      return json(events);
    }
    if (method === "GET" && (path === `/api/events/${demoEvent.id}` || path === `/api/events/${demoEvent.slug}`)) {
      return json({ ...demoEvent, ticketTypes: [ticketType] });
    }
    if (method === "GET" && (path === `/api/events/${seatedEvent.id}` || path === `/api/events/${seatedEvent.slug}`)) {
      return json({ ...seatedEvent, ticketTypes: [seatedTicketType] });
    }
    if (method === "GET" && path === `/api/events/${demoEvent.id}/ticket-types`) {
      return json([ticketType]);
    }
    if (method === "GET" && path === `/api/events/${seatedEvent.id}/ticket-types`) {
      return json([seatedTicketType]);
    }
    if (method === "GET" && path === `/api/events/${seatedEvent.id}/seats`) {
      return json(seatedResponse);
    }
    if (method === "GET" && path === `/api/events/${demoEvent.id}/related`) {
      return json([seatedEvent]);
    }
    if (method === "GET" && path === `/api/events/${seatedEvent.id}/related`) {
      return json([demoEvent]);
    }
    if (method === "GET" && path === "/api/cart") {
      return json(cartItems);
    }
    if (method === "POST" && path === "/api/cart/items") {
      if (currentUser.role !== "CUSTOMER") {
        return json({ code: "FORBIDDEN", message: "Las cuentas operativas no pueden comprar boletos" }, 403);
      }
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
      const body = request.postDataJSON() as { qrToken?: string; ticketId?: string };
      if (body.qrToken === "invalid-demo-token") {
        return json({ code: "BAD_REQUEST", message: "QR firmado invalido" }, 400);
      }
      if (body.ticketId === purchasedTicket.id) {
        scanAttempts += 1;
        if (scanAttempts > 1) {
          return json({ code: "CONFLICT", message: "Boleto ya no esta activo: USED" }, 409);
        }
      }
      return json({ success: true, ticketId: purchasedTicket.id, result: "ACCEPTED" });
    }
    if (method === "GET" && path === "/api/admin/events") {
      return json([
        { ...demoEvent, status: "PUBLISHED", contract_address: "CDERIVEDCONTRACTQA1234567890" },
        { ...seatedEvent, status: "PUBLISHED", contract_address: null },
      ]);
    }
    if (method === "GET" && path === "/api/admin/venues") {
      return json([]);
    }
    if (method === "GET" && path === "/api/admin/contracts") {
      return json({
        factoryContractId: "GBMFIYOGHHNXJGUVWXTDUMLZJ2IRO3T2OOPG5CQPBEVLA2OO3SYPK2B2",
        events: [
          {
            id: demoEvent.id,
            title: demoEvent.title,
            contract_address: "CDERIVEDCONTRACTQA1234567890",
            created_at: "2026-05-11T16:00:00.000Z",
          },
        ],
      });
    }
    if (method === "GET" && path === "/api/admin/claims") {
      return json([]);
    }

    return json({ code: "NOT_MOCKED", message: `${method} ${path}` }, 404);
  });
}

async function login(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("tu@email.com").fill(email);
  await page.getByPlaceholder("••••••••").fill("demo1234");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.locator("main")).toContainText(/Mi Cuenta|Secure Ticket Console/);
}

test.beforeEach(async ({ page }) => {
  await mockDemoApi(page);
});

test("cliente: login, compra y consulta entradas sin Freighter real", async ({ page }) => {
  await login(page, demoCustomer.email);

  await page.goto(`/evento/${demoEvent.id}/boletas`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: `Agregar ${ticketType.name}` }).click();
  await page.getByRole("button", { name: /Agregar al Carrito/i }).click();

  await expect(page.getByText("Tu Carrito")).toBeVisible();
  await expect(page.getByText(demoEvent.title)).toBeVisible();
  await page.getByRole("link", { name: "Continuar al Checkout" }).click();

  await page.getByPlaceholder("Juan Pérez").fill("Ana Cliente");
  await page.getByPlaceholder("juan@email.com").fill(demoCustomer.email);
  await page.getByPlaceholder("3001234567").fill(demoCustomer.phone);
  await page.getByPlaceholder("1020304050").fill(demoCustomer.documentNumber);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel(/Acepto los/i).check();
  await page.getByRole("button", { name: /Confirmar compra simulada/i }).click();

  await expect(page.getByText("Compra Simulada Exitosa")).toBeVisible();
  await page.getByRole("link", { name: "Ver Confirmación" }).click();
  await expect(page.getByText("¡Compra Confirmada!")).toBeVisible();
  await expect(page.getByText("ORD-DEMO-QA")).toBeVisible();

  await page.goto("/mi-cuenta/entradas", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(demoEvent.title)).toBeVisible();
});

test("staff: dashboard operativo, scanner y mapa de asientos solo lectura", async ({ page }) => {
  await login(page, demoStaff.email);

  await expect(page.getByText(/Esta cuenta es operativa/i)).toBeVisible();
  await expect(page.getByText("Secure Ticket Scanner")).toBeVisible();

  await page.goto(`/evento/${seatedEvent.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Estado del evento")).toBeVisible();
  await expect(page.getByText("Ver mapa de asientos")).toBeVisible();
  await page.getByRole("link", { name: /Ver mapa de asientos/i }).click();
  await expect(page.getByText("Mapa Operativo de Asientos")).toBeVisible();
  await expect(page.getByText("Las cuentas operativas no pueden seleccionar ni reservar asientos.")).toBeVisible();
  await expect(page.getByText("Estado del aforo")).toBeVisible();

  await page.goto("/carrito", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Carrito no disponible")).toBeVisible();
});

test("E2E-SCAN-01 UI: staff ve exito/error de scanner y customer no accede", async ({ page }) => {
  // El scanner operativo es DB-first. La redencion on-chain se valida en CONTRACT-REDEEM-01.
  await login(page, demoStaff.email);

  await page.evaluate((payload) => window.localStorage.setItem("e2eScanPayload", payload), JSON.stringify({ ticketId: purchasedTicket.id }));
  await page.goto("/escanear", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Secure Ticket Scanner")).toBeVisible();
  await page.getByRole("button", { name: "Simular escaneo QA" }).click();
  await expect(page.getByText("Acceso Permitido")).toBeVisible();

  await page.waitForTimeout(3200);
  await page.getByRole("button", { name: "Simular escaneo QA" }).click();
  await expect(page.getByText("Acceso Denegado")).toBeVisible();
  await expect(page.getByText("Boleto ya no esta activo: USED")).toBeVisible();

  await page.waitForTimeout(3200);
  await page.evaluate(() => window.localStorage.setItem("e2eScanPayload", JSON.stringify({ qrToken: "invalid-demo-token" })));
  await page.getByRole("button", { name: "Simular escaneo QA" }).click();
  await expect(page.getByText("Acceso Denegado")).toBeVisible();
  await expect(page.getByText("QR firmado invalido")).toBeVisible();

  await page.evaluate(() => window.localStorage.clear());
  await login(page, demoCustomer.email);
  await page.goto("/escanear", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/$/);
});

test("admin: consola, contratos y cuenta maestra ocultable", async ({ page }) => {
  await login(page, demoAdmin.email);

  await expect(page.getByText("Secure Ticket Console")).toBeVisible();
  await page.getByRole("button", { name: /Contratos Secure Ticket/i }).click();
  await expect(page.getByText("Explorador Secure Ticket On-Chain")).toBeVisible();
  await expect(page.getByText(/GBMFIYOG.*B2/)).toBeVisible();
  await page.getByRole("button", { name: "Mostrar cuenta maestra" }).click();
  await expect(page.getByText("GBMFIYOGHHNXJGUVWXTDUMLZJ2IRO3T2OOPG5CQPBEVLA2OO3SYPK2B2")).toBeVisible();
  await page.getByRole("button", { name: "Ocultar cuenta maestra" }).click();
  await expect(page.getByText("GBMFIYOGHHNXJGUVWXTDUMLZJ2IRO3T2OOPG5CQPBEVLA2OO3SYPK2B2")).toHaveCount(0);
});
