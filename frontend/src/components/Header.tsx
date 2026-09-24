import Link from 'next/link';
import { WalletConnect } from './WalletConnect';
import NetworkBadge from './NetworkBadge';

function Header() {
  return (
    <header className="mx-auto flex w-full max-w-[680px] flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-6 sm:pt-10">
      <div className="flex items-baseline gap-3">
        <Link href="/" className="wide text-[28px] font-extrabold leading-none tracking-tight">
          Stamp
        </Link>
        <NetworkBadge />
      </div>
      <WalletConnect />
    </header>
  );
}

export default Header;
