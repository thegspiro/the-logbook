import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const Welcome: React.FC = () => {
  const [showTitle, setShowTitle] = useState(false);
  const [showParagraph, setShowParagraph] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Show title after 3 seconds
    const titleTimer = setTimeout(() => {
      setShowTitle(true);
    }, 3000);

    // Show paragraph 1 second after title
    const paragraphTimer = setTimeout(() => {
      setShowParagraph(true);
    }, 4000);

    // Auto-redirect to onboarding status check after 8 seconds
    const redirectTimer = setTimeout(() => {
      navigate('/onboarding');
    }, 10000);

    return () => {
      clearTimeout(titleTimer);
      clearTimeout(paragraphTimer);
      clearTimeout(redirectTimer);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full text-center space-y-8">
        {/* Title */}
        <h1
          className={`text-6xl md:text-7xl font-bold text-white transition-all duration-1000 ${
            showTitle
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-8'
          }`}
        >
          Welcome to{' '}
          <span className="bg-gradient-to-r from-red-400 to-orange-500 bg-clip-text text-transparent">
            The Logbook
          </span>
        </h1>

        {/* Paragraph */}
        <div
          className={`transition-all duration-1000 delay-300 ${
            showParagraph
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-8'
          }`}
        >
          <p className="text-xl md:text-2xl text-slate-300 leading-relaxed">
            A secure, HIPAA-compliant department intranet built by a local
            volunteer fire department and shared with the world to help other
            volunteer departments manage their operations, training, and
            community service.
          </p>

          {/* Badge indicators */}
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
            <span className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-slate-200 border border-white/20">
              🔒 HIPAA Compliant
            </span>
            <span className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-slate-200 border border-white/20">
              ♿ Section 508 Accessible
            </span>
            <span className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-slate-200 border border-white/20">
              🔐 Zero Plain Text Passwords
            </span>
            <span className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full text-slate-200 border border-white/20">
              📋 Tamper-Proof Audit Logs
            </span>
          </div>

          {/* Call to action */}
          <div className="mt-12">
            <button
              onClick={() => navigate('/onboarding')}
              className="px-8 py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white text-lg font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              Get Started
            </button>
          </div>

          {/* Footer */}
          <div className="mt-12 text-slate-400 text-sm">
            <p>
              Built with ❤️ by volunteer firefighters, for volunteer
              firefighters
            </p>
            <p className="mt-2">
              Open Source • MIT Licensed • Community Driven
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
