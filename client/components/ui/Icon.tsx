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
} from "lucide-react";

const icons = {
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
};

export type IconName = keyof typeof icons;

type Props = {
    name: IconName;
    size?: number | string;
};

export function Icon({ name, size = 24 }: Props) {
    const IconComponent = icons[name];

    return <IconComponent size={size} strokeWidth={2.5} />;
}
