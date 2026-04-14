import { _decorator, Component, Slider, Button } from 'cc';
import { GameLayerZoom } from './GameLayerZoom';
const { ccclass, property } = _decorator;

/**
 * UI 层缩放控制：滑动条（显示并调节缩放进度）+ 放大/缩小按钮，与 GameLayerZoom 同步。
 * 放在 UI 层节点下（如 LevelEditorUI 下新建 ZoomControl 节点），绑定 zoomController（GameLayerZoom）、slider、zoomInBtn、zoomOutBtn。
 */
@ccclass('ZoomControlUI')
export class ZoomControlUI extends Component {

    @property(GameLayerZoom)
    zoomController: GameLayerZoom | null = null;

    @property(Slider)
    slider: Slider | null = null;

    @property(Button)
    zoomInBtn: Button | null = null;

    @property(Button)
    zoomOutBtn: Button | null = null;

    @property({ tooltip: '按钮单次步进比例' })
    stepRatio: number = 0.15;

    private _sliderLock = false;

    onLoad() {
        if (this.slider) {
            this.slider.node.on('slide', this._onSliderSlide, this);
        }
        if (this.zoomInBtn) {
            this.zoomInBtn.node.on(Button.EventType.CLICK, this._onZoomIn, this);
        }
        if (this.zoomOutBtn) {
            this.zoomOutBtn.node.on(Button.EventType.CLICK, this._onZoomOut, this);
        }
    }

    start() {
        this._syncSliderFromZoom();
    }

    update(_dt: number) {
        this._syncSliderFromZoom();
    }

    private _syncSliderFromZoom(): void {
        if (!this.zoomController || !this.slider || this._sliderLock) return;
        const min = this.zoomController.getMinScale();
        const max = this.zoomController.getMaxScale();
        const s = this.zoomController.getZoomScale();
        const progress = (s - min) / (max - min);
        if (Math.abs(this.slider.progress - progress) > 0.001) {
            this.slider.progress = progress;
        }
    }

    private _onSliderSlide(slider: Slider): void {
        if (!this.zoomController) return;
        this._sliderLock = true;
        const min = this.zoomController.getMinScale();
        const max = this.zoomController.getMaxScale();
        const s = min + slider.progress * (max - min);
        this.zoomController.setZoomScale(s);
        this._sliderLock = false;
    }


    private _onZoomIn(): void {
        if (!this.zoomController) return;
        const s = this.zoomController.getZoomScale();
        const next = Math.min(this.zoomController.getMaxScale(), s * (1 + this.stepRatio));
        this.zoomController.setZoomScale(next);
    }

    private _onZoomOut(): void {
        if (!this.zoomController) return;
        const s = this.zoomController.getZoomScale();
        const next = Math.max(this.zoomController.getMinScale(), s * (1 - this.stepRatio));
        this.zoomController.setZoomScale(next);
    }
}
