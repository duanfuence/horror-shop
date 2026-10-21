import Phaser from 'phaser';
import type { GameSession } from '../../core/GameSession';
import { SPOTS } from '../art/cctv';

/** Как рисовать визуальный ключ на камере: текстура, точка, рост фигуры в метрах. */
interface Placement {
  key: string;
  spot: string;
  meters?: number;
  px?: number;
  alpha?: number;
}

const CUSTOMER_FIG: Record<string, string> = {
  grey: 'fig_coat',
  gp: 'fig_coat',
  misha: 'fig_coat',
  relief: 'fig_vest_front',
};

function placementFor(cam: number, visual: string): Placement | null {
  if (visual.startsWith('customer:')) {
    const id = visual.split(':')[1];
    if (cam === 1) return { key: CUSTOMER_FIG[id] ?? 'fig_jacket', spot: 'cam1_customer', meters: 1.75 };
    if (cam === 3) return { key: `top_${id}`, spot: 'cam3_customer', px: 40 };
    return null;
  }
  switch (`${cam}:${visual}`) {
    case '1:clerk':
      return { key: 'fig_vest', spot: 'cam1_clerk', meters: 1.75 };
    case '1:vest_figure':
      return { key: 'fig_vest', spot: 'cam1_vest', meters: 1.75 };
    case '1:relief_aisle':
      return { key: 'fig_vest_front', spot: 'cam1_relief', meters: 1.75 };
    case '2:grey_parking':
      return { key: 'fig_coat', spot: 'cam2_grey', meters: 1.75 };
    case '2:taxi':
      return { key: 'taxi', spot: 'cam2_taxi', px: 28 };
    case '3:clerk':
      return { key: 'top_clerk', spot: 'cam3_clerk', px: 40 };
    case '4:figure1':
      return { key: 'fig_storage', spot: 'cam4_fig1', meters: 1.75 };
    case '4:figure2':
      return { key: 'fig_storage', spot: 'cam4_fig2', meters: 1.75 };
    case '4:waving':
      return { key: 'fig_wave', spot: 'cam4_fig3', meters: 1.75 };
    // аномалии (src/content/shift1/anomalies.ts)
    case '1:clerk_facing':
      return { key: 'fig_storage', spot: 'cam1_clerk', meters: 1.75 };
    case '2:walker1':
      return { key: 'fig_jacket', spot: 'cam2_walk1', meters: 1.75 };
    case '2:dog1':
      return { key: 'dog', spot: 'cam2_dog1', meters: 0.45 };
    case '2:walker2':
      return { key: 'fig_jacket', spot: 'cam2_walk2', meters: 1.75 };
    case '2:dog2':
      return { key: 'dog', spot: 'cam2_dog2', meters: 0.45 };
    case '3:behind1':
      return { key: 'top_dark', spot: 'cam3_behind1', px: 40, alpha: 0.85 };
    case '3:behind2':
      return { key: 'top_dark', spot: 'cam3_behind2', px: 40, alpha: 0.9 };
    case '4:door_figure':
      return { key: 'fig_vest_front', spot: 'cam4_door', meters: 1.75, alpha: 0.8 };
    // видно только на записи (архив камер)
    case '1:rec_fridge_fig':
      return { key: 'fig_vest_front', spot: 'cam1_fridge', meters: 1.75, alpha: 0.9 };
    case '1:rec_near_fig':
      return { key: 'fig_vest_front', spot: 'cam1_near', meters: 1.75, alpha: 0.9 };
    case '2:rec_entry1':
      return { key: 'fig_vest_front', spot: 'cam2_entry1', meters: 1.75 };
    case '2:rec_entry2':
      return { key: 'fig_vest_front', spot: 'cam2_entry2', meters: 1.75 };
    // фоновые силуэты режиссёра тревоги
    case '1:amb_aisle':
      return { key: 'fig_dark', spot: 'cam1_amb', meters: 1.8 };
    case '2:amb_lot':
      return { key: 'fig_dark', spot: 'cam2_amb', meters: 1.8 };
    default:
      return null;
  }
}

/** Экран камер наблюдения: монохромная картинка, помехи, бегущая полоса, вспышка помех при переключении. */
export class CctvScene extends Phaser.Scene {
  private cam: 1 | 2 | 3 | 4 = 1;
  private base!: Phaser.GameObjects.Image;
  private overlay!: Phaser.GameObjects.Container;
  private noise!: Phaser.GameObjects.TileSprite;
  private band!: Phaser.GameObjects.Rectangle;
  private staticBurst!: Phaser.GameObjects.TileSprite;
  private darkRect!: Phaser.GameObjects.Rectangle;
  private frost!: Phaser.GameObjects.Image;
  private lastKey = '';
  private refreshTimer = 0;
  /** Минута записи, которую показывает экран; null — прямой эфир. */
  private archive: number | null = null;
  /** Вид «кассеты»: тёплый оттенок старой плёнки и широкая полоса трекинга. */
  private tapeTint!: Phaser.GameObjects.Rectangle;
  private tracking!: Phaser.GameObjects.TileSprite;

  constructor(private session: () => GameSession) {
    super({ key: 'cctv' });
  }

  create(): void {
    this.add.rectangle(0, 0, 320, 180, 0x000000).setOrigin(0);
    this.base = this.add.image(0, 0, 'cam1').setOrigin(0);
    this.overlay = this.add.container(0, 0);
    this.darkRect = this.add.rectangle(0, 0, 320, 180, 0x000000, 0.5).setOrigin(0).setVisible(false);
    this.frost = this.add.image(0, 0, 'frost').setOrigin(0).setAlpha(0).setTint(0xcfffe0);
    this.noise = this.add.tileSprite(0, 0, 320, 180, 'noise').setOrigin(0).setAlpha(0.1);
    this.band = this.add.rectangle(0, 0, 320, 10, 0xdfffee, 0.06).setOrigin(0);
    this.add.image(0, 0, 'vignette').setOrigin(0).setAlpha(0.9);
    this.tapeTint = this.add.rectangle(0, 0, 320, 180, 0xffd9a0, 0.16).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
    this.tracking = this.add.tileSprite(0, 0, 320, 7, 'noise').setOrigin(0).setAlpha(0.35).setVisible(false);
    this.staticBurst = this.add.tileSprite(0, 0, 320, 180, 'noise').setOrigin(0).setAlpha(0);
    this.scene.sleep();
    const off = this.session().bus.on('fx', ({ id }) => {
      if (id !== 'monitor_glitch' || !this.scene.isActive()) return;
      this.staticBurst.setAlpha(0.7);
      this.tweens.add({ targets: this.staticBurst, alpha: 0, duration: 500 });
    });
    this.events.once('shutdown', off);
  }

  show(cam: 1 | 2 | 3 | 4): void {
    this.cam = cam;
    this.lastKey = '';
    this.refresh();
    this.staticBurst.setAlpha(0.9);
    this.tweens.add({ targets: this.staticBurst, alpha: 0, duration: 260 });
  }

  /**
   * Показать запись за минуту (null — прямой эфир). Кадр строится из записанного списка
   * визуальных ключей тем же кодом, что и эфир; пересоздаются только изменившиеся слои.
   */
  setArchive(minute: number | null): void {
    const modeChanged = (minute === null) !== (this.archive === null);
    this.archive = minute;
    this.tapeTint.setVisible(minute !== null);
    this.tracking.setVisible(minute !== null);
    this.noise.setAlpha(minute !== null ? 0.18 : 0.1);
    this.refresh();
    if (modeChanged) {
      this.staticBurst.setAlpha(0.8);
      this.tweens.add({ targets: this.staticBurst, alpha: 0, duration: 320 });
    }
  }

  private refresh(): void {
    const session = this.session();
    const s = session.state;
    let visuals: string[];
    if (this.archive !== null) {
      visuals = session.archiveVisuals(this.cam, this.archive);
      if (!visuals.length) visuals = ['off'];
    } else {
      const customer = session.customer?.id ?? null;
      visuals = [
        ...session.shift.cameraVisuals(this.cam, s, customer),
        ...session.visibleCameraEvents(this.cam).map((e) => e.visual),
        ...session.anomalyVisuals(this.cam),
      ];
    }
    const key = `${this.archive ?? 'live'}|${this.cam}|${visuals.join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const off = visuals.includes('off');
    // Аномалия может подменить сам кадр (например, стул на складе стоит в другом месте).
    const baseOverride = visuals.find((v) => v.startsWith('base:'));
    this.base.setTexture(baseOverride ? baseOverride.slice(5) : `cam${this.cam}`).setVisible(!off);
    this.overlay.removeAll(true);
    this.darkRect.setVisible(visuals.includes('dark'));
    this.frost.setAlpha(visuals.includes('frost') ? 0.55 : 0);
    if (off) return;
    if (this.cam === 4 && visuals.includes('door_open')) this.overlay.add(this.add.image(0, 0, 'cam4_door').setOrigin(0));
    for (const v of visuals) {
      if (v.startsWith('ov:')) this.overlay.add(this.add.image(0, 0, `ov_${v.slice(3)}`).setOrigin(0));
    }
    const hideClerk = visuals.includes('no_clerk') || visuals.includes('clerk_facing');
    for (const v of visuals) {
      if (v === 'clerk' && hideClerk) continue;
      if (this.cam === 4 && v === 'figure3') {
        this.overlay.add(this.add.image(200, 182, 'close_face').setOrigin(0.5, 1).setScale(1.25));
        continue;
      }
      const p = placementFor(this.cam, v);
      const spot = p && SPOTS[p.spot];
      if (!p || !spot) continue;
      const img = this.add.image(spot.x, spot.y, p.key).setOrigin(0.5, 1);
      const targetH = p.px ?? (p.meters ?? 1.75) * spot.s;
      img.setScale(targetH / img.height);
      if (p.key.startsWith('top_')) img.setOrigin(0.5, 0.5);
      if (p.alpha !== undefined) img.setAlpha(p.alpha);
      this.overlay.add(img);
    }
  }

  update(_t: number, delta: number): void {
    this.noise.tilePositionX = Math.random() * 128;
    this.noise.tilePositionY = Math.random() * 128;
    this.staticBurst.tilePositionX = Math.random() * 128;
    this.band.y = (this.band.y + delta * 0.03) % 190 - 5;
    if (this.archive !== null) {
      // полоса трекинга видеомагнитофона медленно ползёт снизу вверх
      this.tracking.tilePositionX = Math.random() * 128;
      this.tracking.y = 180 - ((this.time.now / 22) % 200);
    }
    this.refreshTimer -= delta;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 250;
      this.refresh();
    }
    // редкие «рывки» картинки, чаще — когда холодно
    const cold = this.session().temperature() < 0;
    if (Math.random() < (cold ? 0.02 : 0.004)) {
      this.cameras.main.setScroll(0, (Math.random() - 0.5) * 3);
      this.time.delayedCall(60, () => this.cameras.main.setScroll(0, 0));
    }
  }
}
