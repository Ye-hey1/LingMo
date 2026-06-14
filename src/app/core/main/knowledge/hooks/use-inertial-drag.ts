import { useCallback, useRef, useEffect } from 'react';

interface InertialDragOptions {
  onDrag: (deltaX: number, deltaY: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (velocityX: number, velocityY: number) => void;
  friction?: number;
  maxVelocity?: number;
}

export function useInertialDrag({
  onDrag,
  onDragStart,
  onDragEnd,
  friction = 0.92,
  maxVelocity = 25,
}: InertialDragOptions) {
  const isDragging = useRef(false);
  const lastPosition = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const animationFrame = useRef<number>(0);
  const lastTime = useRef(0);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;

    isDragging.current = true;
    lastPosition.current = { x: event.clientX, y: event.clientY };
    lastTime.current = Date.now();
    velocity.current = { x: 0, y: 0 };

    onDragStart?.();

    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
    }
  }, [onDragStart]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isDragging.current) return;

    const currentTime = Date.now();
    const deltaTime = Math.max(1, currentTime - lastTime.current);

    const deltaX = event.clientX - lastPosition.current.x;
    const deltaY = event.clientY - lastPosition.current.y;

    velocity.current = {
      x: (deltaX / deltaTime) * 16,
      y: (deltaY / deltaTime) * 16,
    };

    const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);
    if (speed > maxVelocity) {
      velocity.current.x = (velocity.current.x / speed) * maxVelocity;
      velocity.current.y = (velocity.current.y / speed) * maxVelocity;
    }

    onDrag(deltaX, deltaY);

    lastPosition.current = { x: event.clientX, y: event.clientY };
    lastTime.current = currentTime;
  }, [onDrag, maxVelocity]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;

    isDragging.current = false;
    onDragEnd?.(velocity.current.x, velocity.current.y);

    const animate = () => {
      const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);

      if (speed < 0.5) {
        velocity.current = { x: 0, y: 0 };
        return;
      }

      onDrag(velocity.current.x, velocity.current.y);

      velocity.current.x *= friction;
      velocity.current.y *= friction;

      animationFrame.current = requestAnimationFrame(animate);
    };

    animationFrame.current = requestAnimationFrame(animate);
  }, [onDragEnd, onDrag, friction]);

  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  return {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
  };
}
