import { getTankDexEntry } from '../shared/tankDex';
import type { ProjectileKind } from '../shared/tankTypes';

export function drawTankDexPreview(canvas: HTMLCanvasElement, tankId: string, now: number): void {
  const context = prepareCanvas(canvas);
  if (!context) return;
  const width = canvas.clientWidth || 520;
  const height = canvas.clientHeight || 260;
  const entry = getTankDexEntry(tankId);
  const tankClass = entry.tank;
  const t = now / 1000;
  const centerX = width * 0.48;
  const centerY = height * 0.52;
  const radius = Math.min(42, Math.max(25, (tankClass.bodyRadius ?? 24) * 1.22));
  const aim = Math.sin(t * 0.8) * 0.22;

  context.clearRect(0, 0, width, height);
  drawPreviewBackground(context, width, height, t);

  if (tankClass.weaponLayout.length === 0) {
    const pulse = 1 + Math.sin(t * 4) * 0.04;
    context.strokeStyle = 'rgba(255, 215, 54, 0.52)';
    context.lineWidth = 6;
    context.beginPath();
    context.arc(centerX, centerY, radius * (1.32 + Math.sin(t * 3) * 0.08), 0, Math.PI * 2);
    context.stroke();
    drawPreviewTankBody(context, tankClass.bodyShape, centerX, centerY, radius * pulse, aim + t * 0.35, '#35d0ff');
    return;
  }

  tankClass.weaponLayout.forEach((weapon, index) => {
    const angle = aim + degToRad(weapon.angleDeg);
    const reload = Math.max(150, weapon.reloadMs + (weapon.staggerMs ?? 0));
    const cycle = ((now + index * 83) % reload) / reload;
    const recoil = cycle < 0.14 ? (1 - cycle / 0.14) * 10 : 0;
    const barrelX = centerX + Math.cos(angle) * radius * 0.2 - Math.cos(angle) * recoil;
    const barrelY = centerY + Math.sin(angle) * radius * 0.2 - Math.sin(angle) * recoil;
    drawPreviewBarrel(context, barrelX, barrelY, angle, weapon.length * 1.05, Math.max(8, weapon.width * 1.08));

    const projectileDistance = radius + weapon.offset + weapon.length * 0.8 + cycle * Math.min(width * 0.34, 150);
    const projectileX = centerX + Math.cos(angle) * projectileDistance;
    const projectileY = centerY + Math.sin(angle) * projectileDistance;
    drawPreviewProjectile(context, weapon.projectile.kind, projectileX, projectileY, weapon.projectile.radius * (weapon.sizeScale ?? 1), angle);
  });

  drawPreviewTankBody(context, tankClass.bodyShape, centerX, centerY, radius, aim + (tankClass.abilities.includes('auto-spin-friendly') ? t * 0.45 : 0), '#35d0ff');
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | undefined {
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(260, canvas.clientWidth || canvas.width / scale);
  const height = Math.max(180, canvas.clientHeight || canvas.height / scale);
  const targetWidth = Math.floor(width * scale);
  const targetHeight = Math.floor(height * scale);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  return context;
}

function drawPreviewBackground(context: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#dff8ff');
  gradient.addColorStop(0.55, '#fff8df');
  gradient.addColorStop(1, '#dff5be');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(14, 167, 239, 0.14)';
  context.lineWidth = 1;
  const spacing = 34;
  const offset = (time * 18) % spacing;
  for (let x = -spacing + offset; x < width + spacing; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height * 0.22, height);
    context.stroke();
  }

  context.fillStyle = 'rgba(88, 189, 40, 0.16)';
  context.beginPath();
  context.ellipse(width * 0.5, height + 10, width * 0.46, height * 0.26, 0, 0, Math.PI * 2);
  context.fill();
}

function drawPreviewBarrel(context: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = '#657780';
  context.strokeStyle = '#20323b';
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(0, -width / 2, length, width, 4);
  context.fill();
  context.stroke();
  context.restore();
}

function drawPreviewTankBody(
  context: CanvasRenderingContext2D,
  bodyShape: ReturnType<typeof getTankDexEntry>['tank']['bodyShape'],
  x: number,
  y: number,
  radius: number,
  angle: number,
  color: string,
): void {
  context.fillStyle = color;
  context.strokeStyle = '#eefaff';
  context.lineWidth = 6;
  if (bodyShape === 'square') {
    drawPreviewPolygon(context, x, y, radius, 4, Math.PI / 4);
  } else if (bodyShape === 'spiked') {
    drawPreviewSpiked(context, x, y, radius);
  } else if (bodyShape === 'hex') {
    drawPreviewPolygon(context, x, y, radius, 6, angle);
  } else {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.strokeStyle = 'rgba(7, 39, 76, 0.24)';
  context.lineWidth = 3;
  context.beginPath();
  context.arc(x, y, radius * 0.55, 0, Math.PI * 2);
  context.stroke();
}

function drawPreviewProjectile(context: CanvasRenderingContext2D, kind: ProjectileKind, x: number, y: number, radius: number, angle: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = kind === 'trap' ? '#ffd736' : kind === 'drone' || kind === 'minion' ? '#8f6bff' : kind === 'missile' ? '#f45a45' : '#35d0ff';
  context.strokeStyle = '#172530';
  context.lineWidth = 3;

  if (kind === 'trap') {
    drawPreviewPolygon(context, 0, 0, Math.max(8, radius * 1.1), 3, -Math.PI / 2);
  } else if (kind === 'drone' || kind === 'minion') {
    drawPreviewPolygon(context, 0, 0, Math.max(7, radius * 1.05), 4, Math.PI / 4);
  } else if (kind === 'missile') {
    drawPreviewPolygon(context, 0, 0, Math.max(9, radius * 1.18), 4, 0);
  } else {
    context.beginPath();
    context.arc(0, 0, Math.max(5, radius), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.restore();
}

function drawPreviewPolygon(context: CanvasRenderingContext2D, x: number, y: number, radius: number, sides: number, rotation: number): void {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fill();
  context.stroke();
}

function drawPreviewSpiked(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  for (let index = 0; index < 24; index += 1) {
    const angle = (Math.PI * 2 * index) / 24;
    const spikeRadius = index % 2 === 0 ? radius * 1.18 : radius * 0.82;
    const px = x + Math.cos(angle) * spikeRadius;
    const py = y + Math.sin(angle) * spikeRadius;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fill();
  context.stroke();
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}
