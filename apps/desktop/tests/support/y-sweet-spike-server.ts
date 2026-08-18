import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientToken } from "@y-sweet/sdk";

interface ExitEmitter {
  once(event: "exit", listener: () => void): void;
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (child.exitCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      resolve(exited);
    };
    (child as unknown as ExitEmitter).once("exit", () => finish(true));
    setTimeout(() => finish(false), timeoutMs);
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export class YSweetSpikeServer {
  readonly storePath: string;
  readonly port: number;
  private process: ChildProcessWithoutNullStreams | null = null;
  private output = "";
  private readonly createdDocuments = new Set<string>();

  private constructor(storePath: string, port: number) {
    this.storePath = storePath;
    this.port = port;
  }

  static async create() {
    return new YSweetSpikeServer(
      await mkdtemp(join(tmpdir(), "writer-y-sweet-spike-")),
      await availablePort(),
    );
  }

  async clientToken(documentId: string): Promise<ClientToken> {
    if (!this.createdDocuments.has(documentId)) {
      await this.postJson("/doc/new", { docId: documentId });
      this.createdDocuments.add(documentId);
    }
    return (await this.postJson(`/doc/${documentId}/auth`, {})) as ClientToken;
  }

  async start() {
    if (this.process) return;
    this.output = "";
    const binary = [
      join(process.cwd(), "node_modules/y-sweet/bin/y-sweet"),
      join(process.cwd(), "apps/desktop/node_modules/y-sweet/bin/y-sweet"),
    ].find((candidate) => existsSync(candidate));
    if (!binary) throw new Error("Could not locate the pinned y-sweet test binary");
    const child = spawn(
      binary,
      [
        "serve",
        this.storePath,
        "--host",
        "127.0.0.1",
        "--port",
        String(this.port),
        "--checkpoint-freq-seconds",
        "1",
      ],
      { stdio: "pipe" },
    );
    this.process = child;
    child.stdout.on("data", (chunk) => {
      this.output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      this.output += chunk.toString();
    });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`y-sweet exited before readiness:\n${this.output}`);
      }
      try {
        if (await this.checkReady()) return;
      } catch {
        // The listener may not be ready yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await this.stop();
    throw new Error(`y-sweet did not become ready:\n${this.output}`);
  }

  async stop() {
    const child = this.process;
    if (!child) return;
    this.process = null;
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 5_000))) {
      child.kill("SIGKILL");
      await waitForExit(child, 1_000);
    }
  }

  async destroy() {
    await this.stop();
    await rm(this.storePath, { recursive: true, force: true });
  }

  async checkpointVersion() {
    const entries = await readdir(this.storePath, { recursive: true });
    const versions: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith("data.ysweet")) continue;
      const metadata = await stat(join(this.storePath, entry));
      versions.push(`${entry}:${metadata.mtimeMs}:${metadata.size}`);
    }
    return versions.sort().join("|");
  }

  async waitForCheckpointAfter(previousVersion: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const version = await this.checkpointVersion();
      if (version && version !== previousVersion) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`y-sweet did not checkpoint its local store:\n${this.output}`);
  }

  private async checkReady() {
    try {
      await this.postJson("/check_store", {});
      return true;
    } catch {
      return false;
    }
  }

  private async postJson(path: string, body: object) {
    return await new Promise<unknown>((resolve, reject) => {
      const probe = request(
        `http://127.0.0.1:${this.port}${path}`,
        { method: "POST", headers: { "content-type": "application/json" } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.once("end", () => {
            if (response.statusCode !== 200) {
              reject(new Error(`y-sweet ${path} returned ${response.statusCode}`));
              return;
            }
            const value = Buffer.concat(chunks).toString();
            resolve(value ? JSON.parse(value) : undefined);
          });
        },
      );
      probe.once("error", reject);
      probe.setTimeout(2_000, () => {
        probe.destroy(new Error(`y-sweet ${path} request timed out`));
      });
      probe.end(JSON.stringify(body));
    });
  }
}
