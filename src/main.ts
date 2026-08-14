import { DemoDayApp } from "./app/App.js";
import { DemoMode } from "./app/DemoMode.js";
import { NostrRepository } from "./nostr/repository.js";
import { InMemoryTestTransport, WebSocketNostrTransport } from "./nostr/transport.js";
import "./site-data.js";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Application root #app was not found");
}

const searchParams = new URLSearchParams(globalThis.location.search);

if (searchParams.has("demo")) {
  new DemoMode(root).start();
} else {
  const useMemoryTransport = searchParams.get("transport") === "memory";
  const transport = useMemoryTransport
    ? new InMemoryTestTransport()
    : new WebSocketNostrTransport();
  const repository = new NostrRepository(transport);
  const app = new DemoDayApp(root, repository);
  app.start();
}
