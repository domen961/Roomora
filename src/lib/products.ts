export interface Product {
  id:          string;
  name:        string;
  description: string;
  images:      string[];    // paths under /public/products/ or base64 data URLs
  thumbnail:   string;
  length_cm:   number | null;
  width_cm:    number | null;
  height_cm:   number | null;
}

export const TC_MEBLE_PRODUCTS: Product[] = [
  {
    id: "sharon_1_plush", name: "Sharon 2-seater · Plush",
    description: "compact two-seater sofa with a modern low-profile design, clean straight lines, slightly rounded armrests, small black metal legs, plush fabric, soft and velvety texture, light grey/beige tone",
    images: ["/products/sharon_1_plush_perspective.jpg", "/products/sharon_1_plush_front.jpg"],
    thumbnail: "/products/sharon_1_plush_thumb.jpg",
    length_cm: 165, width_cm: 85, height_cm: 80,
  },
  {
    id: "sharon_1_tweed", name: "Sharon 2-seater · Tweed",
    description: "compact two-seater sofa with a modern low-profile design, clean straight lines, slightly rounded armrests, small black metal legs, tweed fabric, woven texture, warm neutral tone",
    images: ["/products/sharon_1_tweed_perspective.jpg", "/products/sharon_1_tweed_front.jpg"],
    thumbnail: "/products/sharon_1_tweed_thumb.jpg",
    length_cm: 165, width_cm: 85, height_cm: 80,
  },
  {
    id: "sharon_1_leather", name: "Sharon 2-seater · Leather",
    description: "compact two-seater sofa with a modern low-profile design, clean straight lines, slightly rounded armrests, small black metal legs, smooth leather upholstery, orange/tan tone",
    images: ["/products/sharon_1_leather_perspective.jpg", "/products/sharon_1_leather_front.jpg"],
    thumbnail: "/products/sharon_1_leather_thumb.jpg",
    length_cm: 165, width_cm: 85, height_cm: 80,
  },
  {
    id: "sharon_2_plush", name: "Sharon 3-seater · Plush",
    description: "three-seater sofa with a modern low-profile design, clean straight lines, slightly rounded armrests, small black metal legs, plush fabric, soft and velvety texture, light grey/beige tone",
    images: ["/products/sharon_2_plush_perspective.jpg", "/products/sharon_2_plush_front.jpg"],
    thumbnail: "/products/sharon_2_plush_thumb.jpg",
    length_cm: 215, width_cm: 85, height_cm: 80,
  },
  {
    id: "sharon_2_tweed", name: "Sharon 3-seater · Tweed",
    description: "three-seater sofa with a modern low-profile design, clean straight lines, slightly rounded armrests, small black metal legs, tweed fabric, woven texture, warm neutral tone",
    images: ["/products/sharon_2_tweed_perspective.jpg", "/products/sharon_2_tweed_front.jpg"],
    thumbnail: "/products/sharon_2_tweed_thumb.jpg",
    length_cm: 215, width_cm: 85, height_cm: 80,
  },
  {
    id: "sharon_3_plush", name: "Sharon Corner · Plush",
    description: "L-shaped corner sofa with a modern low-profile design, clean straight lines, slightly rounded armrests, small black metal legs, plush fabric, soft and velvety texture, light grey/beige tone",
    images: ["/products/sharon_3_plush_perspective.jpg", "/products/sharon_3_plush_front.jpg"],
    thumbnail: "/products/sharon_3_plush_thumb.jpg",
    length_cm: 260, width_cm: 185, height_cm: 80,
  },
];
