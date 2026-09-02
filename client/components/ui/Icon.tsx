import {
    Heart,
    MessageCircle,
    Share,
    Search,
    Home,
    User,
    Archive,
    LogIn,
    LogOut,
    UserRoundPlus,
    KeyRound,
    LayoutGrid,
    Mail,
    Pen,
    ArrowRight,
    Check,
    Plus,
    Copy,
    Settings,
    Trash,
    Download,
    Upload,
    Eye,
    X,
    RotateCcw,
    Link,
    Play,
    Lock,
    LucideIcon,
    Earth,
    UsersRound,
    CircleUserRound,
    QrCode,
    ArrowLeft,
    Info,
    WandSparkles,
    Loader,
    Loader2,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
    heart: Heart,
    comment: MessageCircle,
    share: Share,
    search: Search,
    home: Home,
    user: User,
    archive: Archive,
    logIn: LogIn,
    logOut: LogOut,
    userRoundPlus: UserRoundPlus,
    keyRound: KeyRound,
    layoutGrid: LayoutGrid,
    mail: Mail,
    pen: Pen,
    arrowRight: ArrowRight,
    arrowLeft: ArrowLeft,
    check: Check,
    plus: Plus,
    copy: Copy,
    settings: Settings,
    trash: Trash,
    download: Download,
    upload: Upload,
    eye: Eye,
    x: X,
    rotateCw: RotateCcw,
    link: Link,
    play: Play,
    lock: Lock,
    earth: Earth,
    usersRound: UsersRound,
    circleUserRound: CircleUserRound,
    qrCode: QrCode,
    info: Info,
    wandSparkles: WandSparkles,
    loader: Loader,
    loaderCircle: Loader2,
};

export type IconName = keyof typeof icons;

export function Icon({
    name,
    size = 24,
    className,
}: {
    name: IconName;
    size?: number | string;
    className?: string;
}) {
    const IconComponent = icons[name];

    if (!IconComponent) return null;

    return (
        <IconComponent
            size={size}
            className={className}
            strokeWidth={2.5}
            data-icon={name}
        />
    );
}
