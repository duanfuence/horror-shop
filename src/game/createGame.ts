import Phaser from 'phaser';
import type { EventBus } from '../core/EventBus';
import type { GameSession } from '../core/GameSession';
import type { HotspotId, StageBridge } from '../ui/UI';
import { CctvScene } from './scenes/CctvScene';
import { StoreScene } from './scenes/StoreScene';
import { registerTextures } from './textures';

export interface GameDeps {
  parent: HTMLElement;
  wrap: HTMLElement;
  bus: EventBus;
  session: () => GameSession;
  onHotspot(id: HotspotId, x: number, y: number): void;
  onHover(label: string | null, x?: number, y?: number): void;
  /** Вызывается каждый кадр с реальным временем (мс). */
  onStep(delta: number): void;
}

/** Создаёт игру Phaser (320×180, пиксельная графика) и возвращает мост для интерфейса. */
export function createGame(deps: GameDeps): Promise<StageBridge & { game: Phaser.Game }> {
  return new Promise((resolve, reject) => {
    const store = new StoreScene({
      bus: deps.bus,
      session: deps.session,
      onHotspot: deps.onHotspot,
      onHover: deps.onHover,
    });
    const cctv = new CctvScene(deps.session);

    class BootScene extends Phaser.Scene {
      constructor() {
        super({ key: 'boot' });
      }
      create(): void {
        try {
          registerTextures(this);
        } catch (err) {
          reject(err);
          return;
        }
        // Мост отдаётся интерфейсу только после того, как обе сцены действительно созданы.
        const created = (key: string) =>
          new Promise<void>((done) => this.scene.get(key).events.once(Phaser.Scenes.Events.CREATE, () => done()));
        void Promise.all([created('store'), created('cctv')]).then(() => resolve(bridge));
        this.scene.launch('store');
        this.scene.launch('cctv');
        this.scene.stop();
      }
    }

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: deps.parent,
      width: 320,
      height: 180,
      backgroundColor: '#000000',
      pixelArt: true,
      roundPixels: true,
      banner: false,
      audio: { noAudio: true },
      disableContextMenu: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: { antialias: false, powerPreference: 'low-power' },
      fps: { target: 60, smoothStep: true },
      scene: [BootScene, store, cctv],
    });

    game.events.on(Phaser.Core.Events.STEP, (_time: number, delta: number) => deps.onStep(delta));

    const bridge: StageBridge & { game: Phaser.Game } = {
      game,
      setMode: (mode) => store.setMode(mode),
      openCctv: (cam) => {
        if (!game.scene.isActive('cctv')) game.scene.wake('cctv');
        game.scene.bringToTop('cctv');
        // Магазин под экраном камер не виден — не тратить на него отрисовку (логика продолжает работать).
        store.sys.setVisible(false);
        cctv.show(cam);
      },
      closeCctv: () => {
        store.sys.setVisible(true);
        if (game.scene.isActive('cctv')) game.scene.sleep('cctv');
      },
      setEffects: (on) => store.setEffects(on),
      toScreen: (x, y) => {
        const canvas = game.canvas.getBoundingClientRect();
        const wrap = deps.wrap.getBoundingClientRect();
        return {
          x: canvas.left - wrap.left + (x * canvas.width) / 320,
          y: canvas.top - wrap.top + (y * canvas.height) / 180,
        };
      },
    };
  });
}
