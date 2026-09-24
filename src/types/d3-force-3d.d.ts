// d3-force-3d (force-graph's physics engine) ships without types; only the
// forces we use are declared here.
declare module "d3-force-3d" {
  type Accessor<N> = number | ((node: N) => number);
  interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }
  export interface RadialForce<N> extends Force<N> {
    strength(strength: Accessor<N>): RadialForce<N>;
  }
  export interface CollideForce<N> extends Force<N> {
    strength(strength: number): CollideForce<N>;
  }
  export function forceRadial<N>(radius: Accessor<N>, x?: number, y?: number): RadialForce<N>;
  export function forceCollide<N>(radius?: Accessor<N>): CollideForce<N>;
}
