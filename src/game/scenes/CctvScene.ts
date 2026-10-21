import Phaser from 'phaser';
import type { GameSession } from '../../core/GameSession';
import { SPOTS } from '../art/cctv';

/** Как рисовать визуальный ключ на камере: текстура, точка, рост фигуры в метрах. */
interface Placement {
  key: string;
  spot: string;
  meters?: number;
  px?: number;
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
    this.staticBurst = this.add.tileSprite(0, 0, 320, 180, 'noise').setOrigin(0).setAlpha(0);
    this.scene.sleep();
  }

  show(cam: 1 | 2 | 3 | 4): void {
    this.cam = cam;
    this.lastKey = '';
    this.refresh();
    this.staticBurst.setAlpha(0.9);
    this.tweens.add({ targets: this.staticBurst, alpha: 0, duration: 260 });
  }

  private refresh(): void {
    const session = this.session();
    const s = session.state;
    const customer = session.customer?.id ?? null;
    const visuals = [
      ...session.shift.cameraVisuals(this.cam, s, customer),
      ...session.visibleCameraEvents(this.cam).map((e) => e.visual),
    ];
    const key = `${this.cam}|${visuals.join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const off = visuals.includes('off');
    this.base.setTexture(`cam${this.cam}`).setVisible(!off);
    this.overlay.removeAll(true);
    this.darkRect.setVisible(visuals.includes('dark'));
    this.frost.setAlpha(visuals.includes('frost') ? 0.55 : 0);
    if (off) return;
    if (this.cam === 4 && visuals.includes('door_open')) this.overlay.add(this.add.image(0, 0, 'cam4_door').setOrigin(0));
    const hideClerk = visuals.includes('no_clerk');
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
      this.overlay.add(img);
    }
  }

  update(_t: number, delta: number): void {
    this.noise.tilePositionX = Math.random() * 128;
    this.noise.tilePositionY = Math.random() * 128;
    this.staticBurst.tilePositionX = Math.random() * 128;
    this.band.y = (this.band.y + delta * 0.03) % 190 - 5;
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
