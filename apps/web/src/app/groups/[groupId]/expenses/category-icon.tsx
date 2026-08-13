import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  Armchair,
  ArrowLeftRight,
  Baby,
  Banknote,
  Bike,
  Bus,
  Calculator,
  Car,
  CarTaxiFront,
  Clapperboard,
  Dices,
  Drama,
  Droplets,
  FerrisWheel,
  Flower2,
  Fuel,
  Gift,
  GraduationCap,
  HandCoins,
  HandHelping,
  Handshake,
  Heart,
  HeartPulse,
  Home,
  Hotel,
  IdCard,
  KeyRound,
  Landmark,
  MonitorPlay,
  Music,
  ParkingMeter,
  PartyPopper,
  PawPrint,
  Plane,
  Plug,
  PlugZap,
  Receipt,
  Repeat,
  Shapes,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Sparkles,
  SprayCan,
  Sprout,
  Stethoscope,
  ThermometerSun,
  Train,
  Trash,
  Trophy,
  Utensils,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from 'lucide-react'

type Category = {
  grouping: string
  name: string
}

export function CategoryIcon({
  category,
  ...props
}: { category: Category | null } & LucideProps) {
  const Icon = getCategoryIcon(`${category?.grouping}/${category?.name}`)
  // oxlint-disable-next-line react/react-compiler -- Lucide icons are stateless components selected from a static mapping.
  return <Icon {...props} />
}

function getCategoryIcon(category: string): LucideIcon {
  switch (category) {
    case 'Uncategorized/Uncategorized':
      return Shapes
    case 'Uncategorized/General':
      return Banknote
    case 'Uncategorized/Payment':
      return HandCoins
    case 'Income/Income':
      return Wallet
    case 'Settlement/Settlement':
      return ArrowLeftRight
    case 'Entertainment/Entertainment':
      return Drama
    case 'Entertainment/Games':
      return Dices
    case 'Entertainment/Movies':
      return Clapperboard
    case 'Entertainment/Music':
      return Music
    case 'Entertainment/Sports':
      return Trophy
    case 'Food and Drink/Food and Drink':
      return Utensils
    case 'Food and Drink/Dining Out':
      return UtensilsCrossed
    case 'Food and Drink/Groceries':
      return ShoppingCart
    case 'Food and Drink/Liquor':
      return Wine
    case 'Home/Home':
      return Home
    case 'Home/Electronics':
      return Plug
    case 'Home/Furniture':
      return Armchair
    case 'Home/Household Supplies':
      return SprayCan
    case 'Home/Maintenance':
      return Wrench
    case 'Home/Gardening':
      return Sprout
    case 'Home/Mortgage':
      return Landmark
    case 'Home/Plants':
      return Flower2
    case 'Home/Pets':
      return PawPrint
    case 'Home/Rent':
      return KeyRound
    case 'Home/Services':
      return Handshake
    case 'Life/Life':
      return Heart
    case 'Life/Childcare':
      return Baby
    case 'Life/Clothing':
      return Shirt
    case 'Life/Donation':
      return HandHelping
    case 'Life/Education':
      return GraduationCap
    case 'Life/Gifts':
      return Gift
    case 'Life/Insurance':
      return ShieldCheck
    case 'Life/Medical Expenses':
      return Stethoscope
    case 'Life/Taxes':
      return Calculator
    case 'Transportation/Transportation':
      return Bus
    case 'Transportation/Bicycle':
      return Bike
    case 'Transportation/Bus/Train':
      return Train
    case 'Transportation/Car':
      return Car
    case 'Transportation/Gas/Fuel':
      return Fuel
    case 'Transportation/Hotel':
      return Hotel
    case 'Transportation/Parking':
      return ParkingMeter
    case 'Transportation/Tolls':
      return Receipt
    case 'Transportation/Plane':
      return Plane
    case 'Transportation/Taxi':
      return CarTaxiFront
    case 'Utilities/Utilities':
      return Zap
    case 'Utilities/Cleaning':
      return Sparkles
    case 'Utilities/Electricity':
      return PlugZap
    case 'Utilities/Heat/Gas':
      return ThermometerSun
    case 'Utilities/Trash':
      return Trash
    case 'Utilities/TV/Phone/Internet':
      return Wifi
    case 'Utilities/Water':
      return Droplets
    case 'Social and Activities/Social and Activities':
      return FerrisWheel
    case 'Social and Activities/Events and Activities':
      return PartyPopper
    case 'Subscriptions and Memberships/Subscriptions and Memberships':
      return Repeat
    case 'Subscriptions and Memberships/Digital Subscriptions':
      return MonitorPlay
    case 'Subscriptions and Memberships/Memberships':
      return IdCard
    case 'Personal Care and Wellness/Personal Care and Wellness':
      return HeartPulse
    default:
      return Banknote
  }
}
