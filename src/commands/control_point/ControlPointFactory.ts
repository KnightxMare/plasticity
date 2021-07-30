import { assertUnreachable } from "../../util/Util";
import * as THREE from "three";
import c3d from '../../../build/Release/c3d.node';
import * as visual from '../../editor/VisualModel';
import { cart2vec, vec2cart } from "../../util/Conversion";
import { GeometryFactory } from '../Factory';

abstract class ControlPointFactory extends GeometryFactory {
    protected curve!: c3d.Curve3D;
    protected instance!: visual.SpaceInstance<visual.Curve3D>;
    readonly originalPosition = new THREE.Vector3();

    _controlPoint!: visual.ControlPoint;
    get controlPoint() { return this._controlPoint }
    set controlPoint(point: visual.ControlPoint) {
        this._controlPoint = point;
        const instance = point.parentItem;
        let model = this.db.lookup(instance);
        model = model.Duplicate().Cast<c3d.SpaceInstance>(c3d.SpaceType.SpaceInstance);
        const item = model.GetSpaceItem()!;

        const curve = item.Cast<c3d.Curve3D>(item.IsA());
        this.curve = curve;
        this.instance = instance;
        let position;
        if (curve instanceof c3d.PolyCurve3D) {
            position = curve.GetPoints()[this.controlPoint.index];
        } else if (curve instanceof c3d.Contour3D) {
            position = curve.FindCorner(this.controlPoint.index);
        } else if (curve instanceof c3d.Arc3D) {
            position = curve.GetLimitPoint(this.controlPoint.index + 1);
        } else throw new Error("not yet supported");
        this.originalPosition.copy(cart2vec(position));
    }

    get originalItem() {
        return this.instance;
    }
}

export class ChangePointFactory extends ControlPointFactory {
    delta!: THREE.Vector3;
    private newPosition = new THREE.Vector3();

    async computeGeometry() {
        const { originalPosition, controlPoint: { index }, delta, curve, newPosition } = this;
        newPosition.copy(originalPosition).add(delta);

        if (curve instanceof c3d.PolyCurve3D) {
            curve.ChangePoint(index, vec2cart(newPosition));
            curve.Rebuild();
        } else if (curve instanceof c3d.Arc3D) {
            if (curve.IsClosed()) {
                const center = cart2vec(curve.GetCentre());
                curve.SetRadius(center.distanceTo(newPosition));
            } else {
                curve.SetLimitPoint(index + 1, vec2cart(newPosition));
            }
        }

        return new c3d.SpaceInstance(curve);
    }
}

export class RemovePointFactory extends ControlPointFactory {
    async computeGeometry() {
        const { controlPoint: { index }, curve } = this;
        if (curve instanceof c3d.PolyCurve3D) {
            curve.RemovePoint(index);
        }
        return new c3d.SpaceInstance(curve);
    }
}