import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { execFile } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type DetectedFile = {
  extension: "jpg" | "png" | "gif" | "webp" | "pdf" | "doc" | "docx";
  mime: string;
  kind: "image" | "document";
};

@Injectable()
export class LocalStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  readonly publicRoot = resolve(process.env.UPLOAD_ROOT ?? resolve(process.cwd(), "uploads"));
  readonly privateRoot = resolve(
    process.env.PRIVATE_UPLOAD_ROOT ?? resolve(process.cwd(), "private_uploads"),
  );

  async savePublicImage(
    file: { buffer?: Buffer },
    folder: "avatars" | "companies" | "products",
    namePrefix: string,
  ) {
    const detected = this.detect(file?.buffer);
    if (!detected || detected.kind !== "image") {
      throw new BadRequestException("O arquivo enviado não é uma imagem válida.");
    }
    const relative = `${folder}/${safePrefix(namePrefix)}-${randomUUID()}.${detected.extension}`;
    await this.writeValidated(this.publicRoot, relative, file.buffer!, true);
    return `/uploads/${relative}`;
  }

  async savePrivateDocument(
    file: { buffer?: Buffer },
    folder: "resumes",
    namePrefix = "documento",
  ) {
    const detected = this.detect(file?.buffer);
    if (!detected || detected.kind !== "document") {
      throw new BadRequestException("O currículo precisa ser um PDF, DOC ou DOCX válido.");
    }
    const relative = `${folder}/${safePrefix(namePrefix)}-${randomUUID()}.${detected.extension}`;
    await this.writeValidated(this.privateRoot, relative, file.buffer!, true);
    return relative;
  }

  async readPrivateFile(relative: string) {
    const path = this.safePath(this.privateRoot, relative);
    const buffer = await readFile(path);
    const detected = this.detect(buffer);
    if (!detected || detected.kind !== "document") {
      throw new BadRequestException("O documento armazenado não é válido.");
    }
    return {
      buffer,
      mime: detected.mime,
      filename: `${basename(relative, `.${detected.extension}`)}.${detected.extension}`,
    };
  }

  async removePublicUrl(url?: string | null) {
    if (!url?.startsWith("/uploads/")) return;
    const relative = url.slice("/uploads/".length);
    await unlink(this.safePath(this.publicRoot, relative)).catch(() => undefined);
  }

  async removePrivateFile(relative?: string | null) {
    if (!relative) return;
    await unlink(this.safePath(this.privateRoot, relative)).catch(() => undefined);
  }

  async cleanupTemporaryFiles(olderThan: Date) {
    const temporaryRoots = [
      this.safePath(this.publicRoot, ".tmp"),
      this.safePath(this.privateRoot, ".tmp"),
    ];
    let removed = 0;

    for (const directory of temporaryRoots) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const path = this.safePath(directory, entry.name);
        const metadata = await stat(path).catch(() => null);
        if (metadata && metadata.mtime < olderThan) {
          await unlink(path).then(() => {
            removed += 1;
          }).catch(() => undefined);
        }
      }
    }

    return removed;
  }

  private async writeValidated(
    root: string,
    relative: string,
    buffer: Buffer,
    scanForMalware: boolean,
  ) {
    const target = this.safePath(root, relative);
    const temporary = this.safePath(root, `.tmp/${randomUUID()}.upload`);
    await mkdir(dirname(target), { recursive: true, mode: 0o750 });
    await mkdir(dirname(temporary), { recursive: true, mode: 0o750 });
    await writeFile(temporary, buffer, { mode: 0o640, flag: "wx" });
    try {
      if (scanForMalware) await this.scan(temporary);
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async scan(path: string) {
    const enabled = process.env.CLAMAV_SCAN_ENABLED === "true";
    if (!enabled) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "A análise de segurança de documentos está temporariamente indisponível.",
        );
      }
      return;
    }
    const command = process.env.CLAMAV_COMMAND ?? "clamdscan";
    const args = [
      ...(process.env.CLAMAV_CONFIG_PATH
        ? [`--config-file=${process.env.CLAMAV_CONFIG_PATH}`]
        : []),
      "--stream",
      "--no-summary",
      path,
    ];
    try {
      await execFileAsync(command, args, {
        timeout: Number(process.env.CLAMAV_TIMEOUT_MS ?? 30_000),
        maxBuffer: 256 * 1024,
      });
    } catch (error) {
      const result = error as { code?: number | string; stdout?: string; stderr?: string };
      if (result.code === 1) {
        this.logger.warn(`Upload bloqueado pelo antivírus: ${basename(path)}`);
        throw new BadRequestException("O documento foi recusado pela verificação de segurança.");
      }
      this.logger.error(`Falha ao consultar o antivírus: ${result.stderr ?? result.stdout ?? result.code}`);
      throw new ServiceUnavailableException(
        "Não foi possível verificar o documento agora. Tente novamente em alguns instantes.",
      );
    }
  }

  private safePath(root: string, relative: string) {
    const normalizedRoot = resolve(root);
    const path = resolve(normalizedRoot, relative);
    if (path !== normalizedRoot && !path.startsWith(`${normalizedRoot}${sep}`)) {
      throw new BadRequestException("Caminho de arquivo inválido.");
    }
    return path;
  }

  private detect(buffer?: Buffer): DetectedFile | null {
    if (!buffer || buffer.length < 8) return null;
    if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
      return { extension: "jpg", mime: "image/jpeg", kind: "image" };
    }
    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return { extension: "png", mime: "image/png", kind: "image" };
    }
    const header = buffer.subarray(0, 12).toString("ascii");
    if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
      return { extension: "gif", mime: "image/gif", kind: "image" };
    }
    if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
      return { extension: "webp", mime: "image/webp", kind: "image" };
    }
    if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
      return { extension: "pdf", mime: "application/pdf", kind: "document" };
    }
    if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
      return { extension: "doc", mime: "application/msword", kind: "document" };
    }
    if (
      startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])
      && buffer.includes(Buffer.from("word/"))
    ) {
      return {
        extension: "docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        kind: "document",
      };
    }
    return null;
  }
}

function startsWith(buffer: Buffer, bytes: number[]) {
  return bytes.every((value, index) => buffer[index] === value);
}

function safePrefix(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "arquivo";
}
