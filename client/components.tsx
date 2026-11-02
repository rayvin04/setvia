import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...values: Parameters<typeof clsx>) => twMerge(clsx(...values));
export function ButtonLink({to,children,secondary=false,className}: {to:string;children:ReactNode;secondary?:boolean;className?:string}) {return <Link className={cn('button',secondary?'button-secondary':'button-primary',className)} to={to}>{children}</Link>}
export function Wordmark(){return <Link to="/" className="wordmark" aria-label="Setvia home"><span className="brand-eyes" aria-hidden="true"><i/><i/></span>setvia<span className="brand-period">.</span></Link>}
export function Header(){return <header className="header"><div className="header-inner"><Wordmark/><nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><Link to="/demos">Explore demos</Link><Link to="/join" className="join-link">Join a Room<ArrowUpRight size={15} aria-hidden="true"/></Link></nav></div></header>}
export function Footer(){return <footer className="footer"><Wordmark/><p>Made for the plans that matter.</p><span>UI prototype · Mocked data</span></footer>}
export function TextLink({children,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){return <a className="text-link" {...props}>{children}</a>}
