import { DemoDayApp } from "./app/App.js";
import { NostrRepository } from "./nostr/repository.js";
import { InMemoryTestTransport, WebSocketNostrTransport } from "./nostr/transport.js";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Application root #app was not found");
}

const useMemoryTransport = new URLSearchParams(globalThis.location.search).get("transport") === "memory";
const transport = useMemoryTransport
  ? new InMemoryTestTransport()
  : new WebSocketNostrTransport();
const repository = new NostrRepository(transport);
const app = new DemoDayApp(root, repository);

app.start();
