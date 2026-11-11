declare module 'clipper-lib' {
  interface IntPoint {
    X: number;
    Y: number;
  }
  type Path = IntPoint[];
  type Paths = Path[];
  interface ClipperOffsetInstance {
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
  }
  interface ClipperInstance {
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: Paths, subjFillType: number, clipFillType: number): boolean;
  }
  const ClipperLib: {
    Paths: new () => Paths;
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: { etOpenSquare: number; etOpenRound: number; etOpenButt: number; etClosedLine: number; etClosedPolygon: number };
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
    PolyType: { ptSubject: number; ptClip: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => ClipperOffsetInstance;
    Clipper: (new () => ClipperInstance) & {
      Area(path: Path): number;
      Orientation(path: Path): boolean;
      PointInPolygon(pt: IntPoint, path: Path): number;
    };
  };
  export default ClipperLib;
}
