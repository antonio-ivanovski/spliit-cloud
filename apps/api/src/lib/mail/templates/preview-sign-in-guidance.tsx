import { SignInGuidanceEmail } from './auth'

const props = {
  brandBaseUrl: 'https://spliit.app',
  methods: 'Google, email sign-in link',
}

export default function Preview() {
  return <SignInGuidanceEmail {...props} />
}

Preview.PreviewProps = props
