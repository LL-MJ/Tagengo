import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Tagengo · 日语学习库',description:'记录单词、例句和语法，通过 OneDrive 同步你的日语学习笔记。',manifest:'/manifest.webmanifest'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
