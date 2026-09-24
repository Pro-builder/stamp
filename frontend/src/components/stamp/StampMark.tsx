import { formatDuration, formatStx } from '@/lib/stamp';

export function StampMark({ price, window, open = true }: { price: bigint; window: bigint; open?: boolean }) {
  return (
    <div className={`stamp ${open ? '' : 'is-closed'}`} role="img" aria-label={`Costs ${formatStx(price)} STX to write`}>
      <div className="stamp-face">
        <span className="text-xs font-semibold">Stamp</span>
        <div>
          <div className="wide text-[40px] font-extrabold leading-none">{formatStx(price)}</div>
          <div className="wide text-sm font-bold">STX</div>
        </div>
        <span className="text-xs">{open ? `Reply within ${formatDuration(Number(window))}` : 'Closed'}</span>
      </div>
    </div>
  );
}
